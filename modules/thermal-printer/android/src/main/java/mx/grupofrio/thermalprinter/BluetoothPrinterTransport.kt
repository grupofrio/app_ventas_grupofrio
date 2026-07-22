package mx.grupofrio.thermalprinter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock

internal interface PrinterSocket {
  fun connect()

  fun write(buffer: ByteArray, offset: Int, length: Int)

  fun close()
}

internal interface PrinterSocketFactory {
  fun createSecure(address: String, serviceUuid: UUID): PrinterSocket

  fun createInsecure(address: String, serviceUuid: UUID): PrinterSocket
}

internal fun interface MonotonicClock {
  fun nowMillis(): Long
}

internal fun interface Pacer {
  fun pause(millis: Long)
}

internal fun interface DiscoveryController {
  fun cancelDiscoveryIfNeeded()
}

internal interface LegacyDiscoveryAdapter {
  fun isDiscovering(): Boolean

  fun cancelDiscovery()
}

internal interface PrintGate {
  fun tryAcquire(): Boolean

  fun release()
}

internal data class BluetoothTransportConfig(
  val connectTimeoutMillis: Long = 12_000,
  val writeIdleTimeoutMillis: Long = 8_000,
  val jobDeadlineMillis: Long = 60_000,
  val maxChunkBytes: Int = 2_048,
  val chunkPacingMillis: Long = 10,
  val bandPacingMillis: Long = 40,
) {
  init {
    require(connectTimeoutMillis > 0) { "Connect timeout must be positive" }
    require(writeIdleTimeoutMillis > 0) { "Write timeout must be positive" }
    require(jobDeadlineMillis > 0) { "Job deadline must be positive" }
    require(maxChunkBytes in 1..MAX_CHUNK_BYTES) { "Chunk size must be between 1 and $MAX_CHUNK_BYTES" }
    require(chunkPacingMillis >= 0) { "Chunk pacing must not be negative" }
    require(bandPacingMillis >= 0) { "Band pacing must not be negative" }
  }

  private companion object {
    const val MAX_CHUNK_BYTES = 2_048
  }
}

internal class AndroidDiscoveryController(
  private val sdkInt: () -> Int,
  private val hasLegacyBluetoothPermission: () -> Boolean,
  private val adapter: LegacyDiscoveryAdapter?,
) : DiscoveryController {
  override fun cancelDiscoveryIfNeeded() {
    if (sdkInt() >= Build.VERSION_CODES.S) return
    if (!hasLegacyBluetoothPermission()) return
    val safeAdapter = adapter ?: return
    if (safeAdapter.isDiscovering()) safeAdapter.cancelDiscovery()
  }
}

class BluetoothPrinterTransport internal constructor(
  private val socketFactory: PrinterSocketFactory,
  private val discoveryController: DiscoveryController,
  private val gate: PrintGate,
  private val encoder: EscPosRasterEncoder,
  private val clock: MonotonicClock,
  private val pacer: Pacer,
  private val config: BluetoothTransportConfig,
) {
  constructor(context: Context) : this(
    socketFactory = AndroidPrinterSocketFactory(context.applicationContext),
    discoveryController = productionDiscoveryController(context.applicationContext),
    gate = ProcessPrintGate,
    encoder = EscPosRasterEncoder(),
    clock = SystemMonotonicClock,
    pacer = ThreadPacer,
    config = BluetoothTransportConfig(),
  )

  fun print(
    address: String,
    raster: MonochromeRaster,
    feedLines: Int = DEFAULT_FEED_LINES,
  ): NativePrintResult {
    // Both calls validate their complete inputs before the process gate or Bluetooth side effects.
    val bands = encoder.bands(raster)
    val feed = encoder.feed(feedLines)
    val bandIterator = bands.iterator()
    val initialize = encoder.initialize()

    if (!gate.tryAcquire()) {
      throw ThermalPrinterException(
        code = BUSY_CODE,
        message = "Printer is busy",
        phase = "gate",
      )
    }

    val deadline = deadlineAfter(clock.nowMillis(), config.jobDeadlineMillis)
    var socket: ManagedSocket? = null
    try {
      cancelDiscovery()
      socket = connect(address, deadline)

      var progress = NativePrintProgress()
      progress = writeBlock(
        socket = socket,
        bytes = initialize,
        rasterPayloadOffset = null,
        initialProgress = progress,
        deadline = deadline,
      )

      while (bandIterator.hasNext()) {
        val band = bandIterator.next()
        progress = writeBlock(
          socket = socket,
          bytes = band.command,
          rasterPayloadOffset = RASTER_HEADER_BYTES,
          initialProgress = progress,
          deadline = deadline,
          completesBand = true,
        )

        if (bandIterator.hasNext()) {
          pace(config.bandPacingMillis, progress, deadline)
        }
      }

      progress = writeBlock(
        socket = socket,
        bytes = feed,
        rasterPayloadOffset = null,
        initialProgress = progress,
        deadline = deadline,
      )
      return NativePrintResult(progress)
    } finally {
      socket?.close()
      gate.release()
    }
  }

  private fun cancelDiscovery() {
    try {
      discoveryController.cancelDiscoveryIfNeeded()
    } catch (error: Throwable) {
      throw connectFailed(error)
    }
  }

  private fun connect(address: String, deadline: Long): ManagedSocket {
    ensureConnectDeadline(deadline)
    return try {
      connectWith(
        create = { socketFactory.createSecure(address, SPP_UUID) },
        deadline = deadline,
        secureAttempt = true,
      )
    } catch (_: SecureConnectIOException) {
      ensureConnectDeadline(deadline)
      connectWith(
        create = { socketFactory.createInsecure(address, SPP_UUID) },
        deadline = deadline,
        secureAttempt = false,
      )
    }
  }

  private fun connectWith(
    create: () -> PrinterSocket,
    deadline: Long,
    secureAttempt: Boolean,
  ): ManagedSocket {
    val socket = try {
      ManagedSocket(create())
    } catch (error: Throwable) {
      throw connectFailed(error)
    }

    return when (
      val outcome = runWorker(
        socket = socket,
        phaseTimeoutMillis = config.connectTimeoutMillis,
        deadline = deadline,
        workerKind = "connect",
      ) {
        socket.delegate.connect()
      }
    ) {
      is WorkerOutcome.Completed -> {
        val error = outcome.error
        if (outcome.jobDeadlineExpired) {
          socket.close()
          throw connectTimeout("job")
        }
        if (outcome.phaseTimeoutExpired) {
          socket.close()
          throw connectTimeout("connect")
        }
        if (error != null) {
          socket.close()
          if (secureAttempt && error is IOException) throw SecureConnectIOException()
          throw connectFailed(error)
        }
        socket
      }
      is WorkerOutcome.TimedOut -> {
        throw connectTimeout(if (outcome.jobDeadlineLimited) "job" else "connect")
      }
    }
  }

  private fun writeBlock(
    socket: ManagedSocket,
    bytes: ByteArray,
    rasterPayloadOffset: Int?,
    initialProgress: NativePrintProgress,
    deadline: Long,
    completesBand: Boolean = false,
  ): NativePrintProgress {
    var progress = initialProgress
    var offset = 0
    while (offset < bytes.size) {
      ensureWriteDeadline(progress, deadline)
      val length = minOf(config.maxChunkBytes, bytes.size - offset)
      val rasterBytes = rasterBytesInSlice(offset, length, rasterPayloadOffset, bytes.size)
      val rasterAttemptStarted = AtomicBoolean()
      val outcome = runWorker(
        socket = socket,
        phaseTimeoutMillis = config.writeIdleTimeoutMillis,
        deadline = deadline,
        workerKind = "write",
        beforeOperation = {
          if (rasterBytes > 0) rasterAttemptStarted.set(true)
        },
      ) {
        socket.delegate.write(bytes, offset, length)
      }
      if (rasterAttemptStarted.get()) progress = progress.withRasterPayloadAttempted()

      when (outcome) {
        is WorkerOutcome.Completed -> {
          val error = outcome.error
          if (error != null) {
            if (outcome.jobDeadlineExpired) throw writeTimeout(progress, "job")
            if (outcome.phaseTimeoutExpired) throw writeTimeout(progress, "write")
            throw writeFailed(progress, error)
          }
          progress = progress.afterConfirmedWrite(
            transportBytes = length.toLong(),
            rasterBytes = rasterBytes.toLong(),
            completesBand = completesBand && offset + length == bytes.size,
          )
          if (outcome.jobDeadlineExpired) throw writeTimeout(progress, "job")
          if (outcome.phaseTimeoutExpired) throw writeTimeout(progress, "write")
        }
        is WorkerOutcome.TimedOut -> {
          throw writeTimeout(progress, if (outcome.jobDeadlineLimited) "job" else "write")
        }
      }

      offset += length
      if (offset < bytes.size) pace(config.chunkPacingMillis, progress, deadline)
    }
    return progress
  }

  private fun pace(millis: Long, progress: NativePrintProgress, deadline: Long) {
    ensureWriteDeadline(progress, deadline)
    if (millis > 0) {
      try {
        pacer.pause(millis)
      } catch (error: InterruptedException) {
        Thread.currentThread().interrupt()
        throw writeFailed(progress, error, phase = "pacing")
      } catch (error: Throwable) {
        throw writeFailed(progress, error, phase = "pacing")
      }
    }
    ensureWriteDeadline(progress, deadline)
  }

  private fun runWorker(
    socket: ManagedSocket,
    phaseTimeoutMillis: Long,
    deadline: Long,
    workerKind: String,
    beforeOperation: () -> Unit = {},
    operation: () -> Unit,
  ): WorkerOutcome {
    val phaseDeadline = deadlineAfter(clock.nowMillis(), phaseTimeoutMillis)
    val remainingJobMillis = remainingMillis(deadline)
    val jobDeadlineLimited = remainingJobMillis <= phaseTimeoutMillis
    val waitMillis = minOf(phaseTimeoutMillis, remainingJobMillis)
    val completed = CountDownLatch(1)
    val failure = AtomicReference<Throwable?>(null)
    val worker = Thread(
      {
        try {
          beforeOperation()
          operation()
        } catch (error: Throwable) {
          failure.set(error)
        } finally {
          completed.countDown()
        }
      },
      "thermal-printer-$workerKind-${WORKER_SEQUENCE.incrementAndGet()}",
    ).apply { isDaemon = true }

    try {
      worker.start()
    } catch (error: Throwable) {
      return WorkerOutcome.Completed(
        error = error,
        phaseTimeoutExpired = false,
        jobDeadlineExpired = false,
      )
    }

    val didComplete = try {
      completed.await(waitMillis, TimeUnit.MILLISECONDS)
    } catch (error: InterruptedException) {
      cancelAndJoin(socket, worker)
      Thread.currentThread().interrupt()
      return WorkerOutcome.Completed(
        error = error,
        phaseTimeoutExpired = false,
        jobDeadlineExpired = false,
      )
    }

    if (!didComplete) {
      cancelAndJoin(socket, worker)
      return WorkerOutcome.TimedOut(jobDeadlineLimited)
    }

    joinCompletely(worker)
    return WorkerOutcome.Completed(
      error = failure.get(),
      phaseTimeoutExpired = remainingMillis(phaseDeadline) == 0L,
      jobDeadlineExpired = remainingMillis(deadline) == 0L,
    )
  }

  private fun cancelAndJoin(socket: ManagedSocket, worker: Thread) {
    socket.close()
    worker.interrupt()
    joinCompletely(worker)
  }

  private fun joinCompletely(worker: Thread) {
    var restoreInterrupt = false
    while (worker.isAlive) {
      try {
        worker.join()
      } catch (_: InterruptedException) {
        restoreInterrupt = true
      }
    }
    if (restoreInterrupt) Thread.currentThread().interrupt()
  }

  private fun ensureConnectDeadline(deadline: Long) {
    if (remainingMillis(deadline) == 0L) throw connectTimeout("job")
  }

  private fun ensureWriteDeadline(progress: NativePrintProgress, deadline: Long) {
    if (remainingMillis(deadline) == 0L) throw writeTimeout(progress, "job")
  }

  private fun remainingMillis(deadline: Long): Long {
    val now = clock.nowMillis()
    return if (deadline <= now) 0 else deadline - now
  }

  private fun connectTimeout(phase: String) = ThermalPrinterException(
    code = CONNECT_TIMEOUT_CODE,
    message = "Bluetooth connection timed out",
    phase = phase,
  )

  private fun connectFailed(cause: Throwable) = ThermalPrinterException(
    code = CONNECT_FAILED_CODE,
    message = "Bluetooth connection failed",
    phase = "connect",
    cause = cause,
  )

  private fun writeTimeout(progress: NativePrintProgress, phase: String) = ThermalPrinterException(
    code = WRITE_TIMEOUT_CODE,
    message = "Bluetooth write timed out",
    phase = phase,
    progress = progress,
  )

  private fun writeFailed(
    progress: NativePrintProgress,
    cause: Throwable,
    phase: String = "write",
  ) = ThermalPrinterException(
    code = WRITE_FAILED_CODE,
    message = "Bluetooth write failed",
    phase = phase,
    progress = progress,
    cause = cause,
  )

  private fun rasterBytesInSlice(
    offset: Int,
    length: Int,
    payloadOffset: Int?,
    blockSize: Int,
  ): Int {
    if (payloadOffset == null) return 0
    val payloadStart = maxOf(offset, payloadOffset)
    val sliceEnd = minOf(offset + length, blockSize)
    return maxOf(0, sliceEnd - payloadStart)
  }

  private sealed interface WorkerOutcome {
    data class Completed(
      val error: Throwable?,
      val phaseTimeoutExpired: Boolean,
      val jobDeadlineExpired: Boolean,
    ) : WorkerOutcome

    data class TimedOut(val jobDeadlineLimited: Boolean) : WorkerOutcome
  }

  private class ManagedSocket(val delegate: PrinterSocket) {
    private val closed = AtomicBoolean()

    fun close() {
      if (!closed.compareAndSet(false, true)) return
      try {
        delegate.close()
      } catch (_: Throwable) {
        // Closing is cancellation/cleanup. It must not replace the stable transport error.
      }
    }
  }

  private class SecureConnectIOException : RuntimeException()

  private companion object {
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    val WORKER_SEQUENCE = AtomicLong()
    const val RASTER_HEADER_BYTES = 8
    const val DEFAULT_FEED_LINES = 4
  }
}

private class AndroidPrinterSocketFactory(
  private val context: Context,
) : PrinterSocketFactory {
  override fun createSecure(address: String, serviceUuid: UUID): PrinterSocket =
    AndroidPrinterSocket(device(address).createRfcommSocketToServiceRecord(serviceUuid))

  override fun createInsecure(address: String, serviceUuid: UUID): PrinterSocket =
    AndroidPrinterSocket(device(address).createInsecureRfcommSocketToServiceRecord(serviceUuid))

  private fun device(address: String) =
    requireNotNull(context.bluetoothAdapter()) { "Bluetooth is unavailable" }
      .getRemoteDevice(address)
}

private class AndroidPrinterSocket(private val socket: BluetoothSocket) : PrinterSocket {
  override fun connect() = socket.connect()

  override fun write(buffer: ByteArray, offset: Int, length: Int) {
    socket.outputStream.write(buffer, offset, length)
  }

  override fun close() = socket.close()
}

private class AndroidLegacyDiscoveryAdapter(
  private val context: Context,
) : LegacyDiscoveryAdapter {
  override fun isDiscovering(): Boolean = context.bluetoothAdapter()?.isDiscovering == true

  override fun cancelDiscovery() {
    context.bluetoothAdapter()?.cancelDiscovery()
  }
}

private object ProcessPrintGate : PrintGate {
  private val lock = ReentrantLock()

  override fun tryAcquire(): Boolean = lock.tryLock()

  override fun release() = lock.unlock()
}

private object SystemMonotonicClock : MonotonicClock {
  override fun nowMillis(): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())
}

private object ThreadPacer : Pacer {
  override fun pause(millis: Long) = Thread.sleep(millis)
}

private fun productionDiscoveryController(context: Context): DiscoveryController {
  return AndroidDiscoveryController(
    sdkInt = { Build.VERSION.SDK_INT },
    hasLegacyBluetoothPermission = {
      context.checkSelfPermission(Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
    },
    adapter = AndroidLegacyDiscoveryAdapter(context),
  )
}

private fun deadlineAfter(start: Long, duration: Long): Long =
  if (start > Long.MAX_VALUE - duration) Long.MAX_VALUE else start + duration

private fun Context.bluetoothAdapter(): BluetoothAdapter? =
  (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
