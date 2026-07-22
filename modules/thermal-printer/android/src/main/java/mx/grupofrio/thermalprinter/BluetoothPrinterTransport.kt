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

internal interface WorkerHooks {
  fun afterInitialDeadlineCheck(workerKind: String) = Unit

  fun beforeWorkerStartDeadlineCheck(workerKind: String) = Unit

  fun beforeOperationDeadlineCheck(workerKind: String) = Unit

  fun afterOperationCompletionCaptured(workerKind: String) = Unit
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
  private val workerHooks: WorkerHooks,
) {
  constructor(context: Context) : this(
    socketFactory = AndroidPrinterSocketFactory(context.applicationContext),
    discoveryController = productionDiscoveryController(context.applicationContext),
    gate = ProcessPrintGate,
    encoder = EscPosRasterEncoder(),
    clock = SystemMonotonicClock,
    pacer = ThreadPacer,
    config = BluetoothTransportConfig(),
    workerHooks = NoOpWorkerHooks,
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

      // Idle time starts before the first control write. Every confirmed write, including ESC/GS
      // control bytes, moves this absolute deadline from the worker's completion timestamp.
      var writeState = WriteState(
        progress = NativePrintProgress(),
        idleDeadline = deadlineAfter(clock.nowMillis(), config.writeIdleTimeoutMillis),
      )
      writeState = writeBlock(
        socket = socket,
        bytes = initialize,
        rasterPayloadOffset = null,
        initialState = writeState,
        jobDeadline = deadline,
      )

      while (bandIterator.hasNext()) {
        val band = bandIterator.next()
        writeState = writeBlock(
          socket = socket,
          bytes = band.command,
          rasterPayloadOffset = RASTER_HEADER_BYTES,
          initialState = writeState,
          jobDeadline = deadline,
          completesBand = true,
        )

        if (bandIterator.hasNext()) {
          pace(config.bandPacingMillis, writeState, deadline)
        }
      }

      writeState = writeBlock(
        socket = socket,
        bytes = feed,
        rasterPayloadOffset = null,
        initialState = writeState,
        jobDeadline = deadline,
      )
      return NativePrintResult(writeState.progress)
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

    val connectDeadline = deadlineAfter(clock.nowMillis(), config.connectTimeoutMillis)
    return when (
      val outcome = runWorker(
        socket = socket,
        operationDeadline = connectDeadline,
        jobDeadline = deadline,
        operationTimeoutPhase = "connect",
        workerKind = "connect",
      ) {
        socket.delegate.connect()
      }
    ) {
      is WorkerOutcome.Completed -> {
        if (outcome.timeoutPhase != null) {
          socket.close()
          throw connectTimeout(outcome.timeoutPhase)
        }
        val error = outcome.error
        if (error != null) {
          socket.close()
          if (secureAttempt && error is IOException) throw SecureConnectIOException()
          throw connectFailed(error)
        }
        socket
      }
      is WorkerOutcome.TimedOut -> {
        socket.close()
        throw connectTimeout(outcome.phase)
      }
    }
  }

  private fun writeBlock(
    socket: ManagedSocket,
    bytes: ByteArray,
    rasterPayloadOffset: Int?,
    initialState: WriteState,
    jobDeadline: Long,
    completesBand: Boolean = false,
  ): WriteState {
    var writeState = initialState
    var offset = 0
    while (offset < bytes.size) {
      ensureWriteDeadlines(writeState, jobDeadline)
      val length = minOf(config.maxChunkBytes, bytes.size - offset)
      val rasterBytes = rasterBytesInSlice(offset, length, rasterPayloadOffset, bytes.size)
      val rasterAttemptStarted = AtomicBoolean()
      val outcome = runWorker(
        socket = socket,
        operationDeadline = writeState.idleDeadline,
        jobDeadline = jobDeadline,
        operationTimeoutPhase = "write",
        workerKind = "write",
        beforeOperation = {
          if (rasterBytes > 0) rasterAttemptStarted.set(true)
        },
      ) {
        socket.delegate.write(bytes, offset, length)
      }
      var progress = writeState.progress
      if (rasterAttemptStarted.get()) progress = progress.withRasterPayloadAttempted()

      when (outcome) {
        is WorkerOutcome.Completed -> {
          if (outcome.operationReturned) {
            progress = progress.afterConfirmedWrite(
              transportBytes = length.toLong(),
              rasterBytes = rasterBytes.toLong(),
              completesBand = completesBand && offset + length == bytes.size,
            )
          }
          if (outcome.timeoutPhase != null) throw writeTimeout(progress, outcome.timeoutPhase)
          val error = outcome.error
          if (error != null) throw writeFailed(progress, error)
          writeState = WriteState(
            progress = progress,
            idleDeadline = deadlineAfter(
              outcome.completionAtMillis,
              config.writeIdleTimeoutMillis,
            ),
          )
        }
        is WorkerOutcome.TimedOut -> {
          throw writeTimeout(progress, outcome.phase)
        }
      }

      offset += length
      if (offset < bytes.size) pace(config.chunkPacingMillis, writeState, jobDeadline)
    }
    return writeState
  }

  private fun pace(requestedMillis: Long, writeState: WriteState, jobDeadline: Long) {
    ensureWriteDeadlines(writeState, jobDeadline)
    if (requestedMillis == 0L) return

    val before = clock.nowMillis()
    val budget = minOf(
      remainingMillisAt(before, jobDeadline),
      remainingMillisAt(before, writeState.idleDeadline),
    )
    val allowedMillis = minOf(requestedMillis, budget)
    if (allowedMillis == 0L) throw writeTimeoutForTimestamp(writeState, jobDeadline, before)

    try {
      pacer.pause(allowedMillis)
    } catch (error: InterruptedException) {
      Thread.currentThread().interrupt()
      val after = clock.nowMillis()
      val timeoutPhase = timeoutPhaseAt(after, jobDeadline, writeState.idleDeadline, "write")
      if (timeoutPhase != null) throw writeTimeout(writeState.progress, timeoutPhase)
      throw writeFailed(writeState.progress, error, phase = "pacing")
    } catch (error: Throwable) {
      val after = clock.nowMillis()
      val timeoutPhase = timeoutPhaseAt(after, jobDeadline, writeState.idleDeadline, "write")
      if (timeoutPhase != null) throw writeTimeout(writeState.progress, timeoutPhase)
      throw writeFailed(writeState.progress, error, phase = "pacing")
    }

    val after = clock.nowMillis()
    val timeoutPhase = timeoutPhaseAt(after, jobDeadline, writeState.idleDeadline, "write")
    if (timeoutPhase != null) throw writeTimeout(writeState.progress, timeoutPhase)
    if (allowedMillis < requestedMillis) {
      val limitingPhase = if (jobDeadline <= writeState.idleDeadline) "job" else "write"
      throw writeTimeout(writeState.progress, limitingPhase)
    }
  }

  private fun runWorker(
    socket: ManagedSocket,
    operationDeadline: Long,
    jobDeadline: Long,
    operationTimeoutPhase: String,
    workerKind: String,
    beforeOperation: () -> Unit = {},
    operation: () -> Unit,
  ): WorkerOutcome {
    val initialTimeout = timeoutPhaseAt(
      clock.nowMillis(),
      jobDeadline,
      operationDeadline,
      operationTimeoutPhase,
    )
    if (initialTimeout != null) {
      socket.close()
      return WorkerOutcome.TimedOut(initialTimeout)
    }
    workerHooks.afterInitialDeadlineCheck(workerKind)
    val preConstructionTimeout = timeoutPhaseAt(
      clock.nowMillis(),
      jobDeadline,
      operationDeadline,
      operationTimeoutPhase,
    )
    if (preConstructionTimeout != null) {
      socket.close()
      return WorkerOutcome.TimedOut(preConstructionTimeout)
    }

    val completed = CountDownLatch(1)
    val completion = AtomicReference<WorkerCompletion?>(null)
    val state = AtomicReference<WorkerState>(WorkerState.Running)
    val worker = Thread(
      {
        try {
          workerHooks.beforeOperationDeadlineCheck(workerKind)
          val operationStart = clock.nowMillis()
          val startTimeout = timeoutPhaseAt(
            operationStart,
            jobDeadline,
            operationDeadline,
            operationTimeoutPhase,
          )
          if (startTimeout != null) {
            state.compareAndSet(
              WorkerState.Running,
              WorkerState.DeadlineReached(startTimeout),
            )
            return@Thread
          }
          if (!state.compareAndSet(WorkerState.Running, WorkerState.Operating)) return@Thread

          var error: Throwable? = null
          var operationReturned = false
          beforeOperation()
          try {
            operation()
            operationReturned = true
          } catch (caught: Throwable) {
            error = caught
          }
          val completionAtMillis = clock.nowMillis()
          val finished = WorkerCompletion(error, completionAtMillis, operationReturned)
          completion.set(finished)
          workerHooks.afterOperationCompletionCaptured(workerKind)
          state.compareAndSet(
            WorkerState.Operating,
            WorkerState.Finished(finished),
          )
        } catch (error: Throwable) {
          val completionAtMillis = clock.nowMillis()
          val failed = WorkerCompletion(error, completionAtMillis, operationReturned = false)
          completion.set(failed)
          val failedState = WorkerState.Finished(failed)
          if (!state.compareAndSet(WorkerState.Running, failedState)) {
            state.compareAndSet(WorkerState.Operating, failedState)
          }
        } finally {
          completed.countDown()
        }
      },
      "thermal-printer-$workerKind-${WORKER_SEQUENCE.incrementAndGet()}",
    ).apply { isDaemon = true }

    fun capturedCompletionBeforeDeadline(): WorkerCompletion? = completion.get()?.takeIf {
      timeoutPhaseAt(
        it.completionAtMillis,
        jobDeadline,
        operationDeadline,
        operationTimeoutPhase,
      ) == null
    }

    workerHooks.beforeWorkerStartDeadlineCheck(workerKind)
    val preStartTimeout = timeoutPhaseAt(
      clock.nowMillis(),
      jobDeadline,
      operationDeadline,
      operationTimeoutPhase,
    )
    if (preStartTimeout != null) {
      socket.close()
      return WorkerOutcome.TimedOut(preStartTimeout)
    }

    try {
      worker.start()
    } catch (error: Throwable) {
      val completionAtMillis = clock.nowMillis()
      return WorkerOutcome.Completed(
        error = error,
        completionAtMillis = completionAtMillis,
        operationReturned = false,
        timeoutPhase = timeoutPhaseAt(
          completionAtMillis,
          jobDeadline,
          operationDeadline,
          operationTimeoutPhase,
        ),
      )
    }

    while (true) {
      when (val observed = state.get()) {
        WorkerState.Running,
        WorkerState.Operating,
        -> {
          val observedAt = clock.nowMillis()
          val timeoutPhase = timeoutPhaseAt(
            observedAt,
            jobDeadline,
            operationDeadline,
            operationTimeoutPhase,
          )
          if (timeoutPhase != null) {
            capturedCompletionBeforeDeadline()?.let { captured ->
              joinCompletely(worker)
              return completedOutcome(
                captured,
                jobDeadline,
                operationDeadline,
                operationTimeoutPhase,
              )
            }
            val cancelled = WorkerState.Cancelled(timeoutPhase)
            if (state.compareAndSet(observed, cancelled)) {
              capturedCompletionBeforeDeadline()?.let { captured ->
                joinCompletely(worker)
                return completedOutcome(
                  captured,
                  jobDeadline,
                  operationDeadline,
                  operationTimeoutPhase,
                )
              }
              cancelAndJoin(socket, worker)
              return completion.get()?.let {
                completedOutcome(it, jobDeadline, operationDeadline, operationTimeoutPhase)
              } ?: WorkerOutcome.TimedOut(timeoutPhase)
            }
            continue
          }

          val waitMillis = minOf(
            remainingMillisAt(observedAt, jobDeadline),
            remainingMillisAt(observedAt, operationDeadline),
          ).coerceAtLeast(1)
          try {
            completed.await(waitMillis, TimeUnit.MILLISECONDS)
          } catch (error: InterruptedException) {
            val aborted = WorkerState.Aborted(error, clock.nowMillis())
            if (state.compareAndSet(observed, aborted)) {
              cancelAndJoin(socket, worker)
              Thread.currentThread().interrupt()
              return WorkerOutcome.Completed(
                error = error,
                completionAtMillis = aborted.completionAtMillis,
                operationReturned = false,
                timeoutPhase = null,
              )
            }
            Thread.currentThread().interrupt()
          }
        }
        is WorkerState.Finished -> {
          joinCompletely(worker)
          return completedOutcome(
            observed.completion,
            jobDeadline,
            operationDeadline,
            operationTimeoutPhase,
          )
        }
        is WorkerState.DeadlineReached -> {
          joinCompletely(worker)
          socket.close()
          return WorkerOutcome.TimedOut(observed.phase)
        }
        is WorkerState.Cancelled -> {
          joinCompletely(worker)
          return completion.get()?.let {
            completedOutcome(it, jobDeadline, operationDeadline, operationTimeoutPhase)
          } ?: WorkerOutcome.TimedOut(observed.phase)
        }
        is WorkerState.Aborted -> {
          joinCompletely(worker)
          return WorkerOutcome.Completed(
            error = observed.error,
            completionAtMillis = observed.completionAtMillis,
            operationReturned = false,
            timeoutPhase = null,
          )
        }
      }
    }
  }

  private fun completedOutcome(
    completion: WorkerCompletion,
    jobDeadline: Long,
    operationDeadline: Long,
    operationTimeoutPhase: String,
  ) = WorkerOutcome.Completed(
    error = completion.error,
    completionAtMillis = completion.completionAtMillis,
    operationReturned = completion.operationReturned,
    timeoutPhase = timeoutPhaseAt(
      completion.completionAtMillis,
      jobDeadline,
      operationDeadline,
      operationTimeoutPhase,
    ),
  )

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
    if (clock.nowMillis() >= deadline) throw connectTimeout("job")
  }

  private fun ensureWriteDeadlines(writeState: WriteState, jobDeadline: Long) {
    val now = clock.nowMillis()
    val phase = timeoutPhaseAt(now, jobDeadline, writeState.idleDeadline, "write")
    if (phase != null) throw writeTimeout(writeState.progress, phase)
  }

  private fun writeTimeoutForTimestamp(
    writeState: WriteState,
    jobDeadline: Long,
    timestamp: Long,
  ): ThermalPrinterException {
    val phase = checkNotNull(
      timeoutPhaseAt(timestamp, jobDeadline, writeState.idleDeadline, "write"),
    )
    return writeTimeout(writeState.progress, phase)
  }

  private fun timeoutPhaseAt(
    timestamp: Long,
    jobDeadline: Long,
    operationDeadline: Long,
    operationPhase: String,
  ): String? {
    val earliestDeadline = minOf(jobDeadline, operationDeadline)
    if (timestamp < earliestDeadline) return null
    return if (jobDeadline <= operationDeadline) "job" else operationPhase
  }

  private fun remainingMillisAt(timestamp: Long, deadline: Long): Long {
    if (timestamp >= deadline) return 0
    if (deadline == Long.MAX_VALUE && timestamp < 0) return Long.MAX_VALUE
    return deadline - timestamp
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
      val completionAtMillis: Long,
      val operationReturned: Boolean,
      val timeoutPhase: String?,
    ) : WorkerOutcome

    data class TimedOut(val phase: String) : WorkerOutcome
  }

  private sealed interface WorkerState {
    object Running : WorkerState

    object Operating : WorkerState

    data class Finished(val completion: WorkerCompletion) : WorkerState

    data class DeadlineReached(val phase: String) : WorkerState

    data class Cancelled(val phase: String) : WorkerState

    data class Aborted(
      val error: Throwable,
      val completionAtMillis: Long,
    ) : WorkerState
  }

  private data class WorkerCompletion(
    val error: Throwable?,
    val completionAtMillis: Long,
    val operationReturned: Boolean,
  )

  private data class WriteState(
    val progress: NativePrintProgress,
    val idleDeadline: Long,
  )

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

internal object ProcessPrintGate : PrintGate {
  private val held = AtomicBoolean()

  override fun tryAcquire(): Boolean = held.compareAndSet(false, true)

  override fun release() {
    check(held.compareAndSet(true, false)) { "Printer gate was not held" }
  }
}

private object SystemMonotonicClock : MonotonicClock {
  override fun nowMillis(): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())
}

private object ThreadPacer : Pacer {
  override fun pause(millis: Long) = Thread.sleep(millis)
}

private object NoOpWorkerHooks : WorkerHooks

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
