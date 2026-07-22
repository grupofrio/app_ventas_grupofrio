package mx.grupofrio.thermalprinter

import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BluetoothPrinterTransportTest {
  @Test
  fun `uses the exact SPP UUID and default timeout and pacing configuration`() {
    val socket = FakeSocket()
    val factory = FakeSocketFactory(secureSocket = socket)

    transport(factory).print(ADDRESS, raster())

    assertEquals(UUID.fromString("00001101-0000-1000-8000-00805F9B34FB"), factory.secureUuids.single())
    assertEquals(12_000L, BluetoothTransportConfig().connectTimeoutMillis)
    assertEquals(8_000L, BluetoothTransportConfig().writeIdleTimeoutMillis)
    assertEquals(60_000L, BluetoothTransportConfig().jobDeadlineMillis)
    assertEquals(2_048, BluetoothTransportConfig().maxChunkBytes)
    assertEquals(10L, BluetoothTransportConfig().chunkPacingMillis)
    assertEquals(40L, BluetoothTransportConfig().bandPacingMillis)
  }

  @Test
  fun `secure success never creates insecure socket and always closes secure socket`() {
    val events = mutableListOf<String>()
    val secure = FakeSocket(events = events, label = "secure")
    val factory = FakeSocketFactory(secureSocket = secure, events = events)

    val result = transport(factory).print(ADDRESS, raster(byteArrayOf(0x55)))

    assertEquals(1, factory.secureCreates)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.connectCalls)
    assertEquals(1, secure.closeCalls)
    assertEquals(14L, result.transportBytesWritten)
    assertEquals(1L, result.rasterBytesWritten)
    assertEquals(1L, result.bandsCompleted)
    assertTrue(result.rasterPayloadAttempted)
  }

  @Test
  fun `secure connect IOException closes secure before one insecure fallback`() {
    val events = mutableListOf<String>()
    val secure = FakeSocket(
      events = events,
      label = "secure",
      connectAction = { throw IOException("radio disconnected") },
    )
    val insecure = FakeSocket(events = events, label = "insecure")
    val factory = FakeSocketFactory(
      secureSocket = secure,
      insecureSocket = insecure,
      events = events,
    )

    transport(factory).print(ADDRESS, raster())

    assertEquals(1, factory.secureCreates)
    assertEquals(1, factory.insecureCreates)
    assertTrue(events.indexOf("secure.close") < events.indexOf("factory.insecure"))
    assertEquals(1, secure.closeCalls)
    assertEquals(1, insecure.closeCalls)
  }

  @Test
  fun `secure timeout never falls back and returns only after close interrupt and join`() {
    val secure = BlockingConnectSocket()
    val factory = FakeSocketFactory(secureSocket = secure)
    val gate = NonReentrantTestGate()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(factory, clock = RealTestClock, gate = gate, config = shortTimeouts())
        .print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("connect", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
    assertFalse(secure.workerThread!!.isAlive)
    assertTrue(secure.workerThread!!.isInterrupted)
    assertZeroProgress(error.progress)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `secure SecurityException never falls back`() {
    val secure = FakeSocket(connectAction = { throw SecurityException("permission detail") })
    val factory = FakeSocketFactory(secureSocket = secure)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(factory).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_FAILED_CODE, error.code)
    assertEquals("connect", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals("Bluetooth connection failed", error.message)
    assertEquals(1, secure.closeCalls)
  }

  @Test
  fun `secure socket factory failure never falls back`() {
    val factory = FakeSocketFactory(
      secureSocket = FakeSocket(),
      secureFactoryError = IOException("factory failed before connect"),
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(factory).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_FAILED_CODE, error.code)
    assertEquals(0, factory.insecureCreates)
  }

  @Test
  fun `write failure after secure connect never falls back and reports conservative progress`() {
    val socket = FakeSocket(failWriteCall = 2, writeError = IOException("output failed"))
    val factory = FakeSocketFactory(secureSocket = socket)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(factory).print(ADDRESS, raster(byteArrayOf(0x33)))
    }

    assertEquals(WRITE_FAILED_CODE, error.code)
    assertEquals("write", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertEquals(0L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `busy rejects with zero progress and no discovery socket or gate release`() {
    val socket = FakeSocket()
    val factory = FakeSocketFactory(secureSocket = socket)
    val discovery = RecordingDiscoveryController()
    val gate = FakePrintGate(acquire = false)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(factory, discovery = discovery, gate = gate).print(ADDRESS, raster())
    }

    assertEquals(BUSY_CODE, error.code)
    assertZeroProgress(error.progress)
    assertEquals(0, discovery.calls)
    assertEquals(0, factory.secureCreates)
    assertEquals(0, gate.releaseCalls)
  }

  @Test
  fun `process gate is non reentrant even on the same thread`() {
    assertTrue(ProcessPrintGate.tryAcquire())
    try {
      assertFalse(ProcessPrintGate.tryAcquire())
    } finally {
      ProcessPrintGate.release()
    }
  }

  @Test
  fun `process gate is shared across transports and reusable after release`() {
    val firstSocket = ManuallyBlockedConnectSocket()
    val firstFailure = AtomicReference<Throwable?>(null)
    val first = Thread {
      try {
        transport(
          FakeSocketFactory(firstSocket),
          gate = ProcessPrintGate,
          config = shortTimeouts(connect = 1_000),
        ).print(ADDRESS, raster())
      } catch (error: Throwable) {
        firstFailure.set(error)
      }
    }

    first.start()
    assertTrue(firstSocket.started.await(1, TimeUnit.SECONDS))
    try {
      val busy = assertThrows(ThermalPrinterException::class.java) {
        transport(FakeSocketFactory(FakeSocket()), gate = ProcessPrintGate)
          .print(ADDRESS, raster())
      }
      assertEquals(BUSY_CODE, busy.code)
    } finally {
      firstSocket.allowConnect()
      first.join(2_000)
    }

    assertFalse(first.isAlive)
    assertEquals(null, firstFailure.get())
    transport(FakeSocketFactory(FakeSocket()), gate = ProcessPrintGate).print(ADDRESS, raster())
  }

  @Test
  fun `injected non reentrant gate releases after connect factory write and pacer failures`() {
    fun assertReusable(gate: NonReentrantTestGate) {
      transport(FakeSocketFactory(FakeSocket()), gate = gate).print(ADDRESS, raster())
      assertFalse(gate.isHeld())
    }

    val factoryGate = NonReentrantTestGate()
    assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(FakeSocket(), secureFactoryError = IOException("factory")),
        gate = factoryGate,
      ).print(ADDRESS, raster())
    }
    assertReusable(factoryGate)

    val connectGate = NonReentrantTestGate()
    assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(
          secureSocket = FakeSocket(connectAction = { throw IOException("secure") }),
          insecureSocket = FakeSocket(connectAction = { throw IOException("insecure") }),
        ),
        gate = connectGate,
      ).print(ADDRESS, raster())
    }
    assertReusable(connectGate)

    val writeGate = NonReentrantTestGate()
    assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(FakeSocket(failWriteCall = 1)),
        gate = writeGate,
      ).print(ADDRESS, raster())
    }
    assertReusable(writeGate)

    val pacerGate = NonReentrantTestGate()
    assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(FakeSocket()),
        gate = pacerGate,
        encoder = EscPosRasterEncoder(bandRows = 1),
        pacer = Pacer { throw IOException("pacer") },
        config = shortTimeouts(bandPacing = 1),
      ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(1, 2)))
    }
    assertReusable(pacerGate)
  }

  @Test
  fun `returned write at idle timeout is confirmed before close interrupt join returns`() {
    val socket = BlockingWriteSocket()
    val gate = NonReentrantTestGate()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = RealTestClock,
        gate = gate,
        config = shortTimeouts(),
      ).print(ADDRESS, raster())
    }
    val callsAtReturn = socket.writeCalls
    Thread.sleep(25)

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("write", error.phase)
    assertEquals(1, socket.closeCalls)
    assertFalse(socket.workerThread!!.isAlive)
    assertTrue(socket.workerThread!!.isInterrupted)
    assertEquals(callsAtReturn, socket.writeCalls)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `interrupted coordinator preserves a returned raster write and cancels worker safely`() {
    val hooks = BlockCompletionPublicationHooks(workerKind = "write", targetCompletion = 2)
    val socket = FakeSocket()
    val gate = NonReentrantTestGate()
    hooks.socketClosed = { socket.closeCalls > 0 }

    val result = interruptCoordinatorAfterCompletionCaptured(hooks) {
      transport(
        FakeSocketFactory(socket),
        gate = gate,
        workerHooks = hooks,
      ).print(ADDRESS, raster())
    }
    val error = result.failure as ThermalPrinterException
    val callsAtReturn = socket.writeCalls
    Thread.sleep(25)

    assertEquals(WRITE_FAILED_CODE, error.code)
    assertEquals("write", error.phase)
    assertTrue(error.cause is InterruptedException)
    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
    assertEquals(2, callsAtReturn)
    assertEquals(callsAtReturn, socket.writeCalls)
    assertEquals(1, socket.closeCalls)
    assertTrue(hooks.closeObservedBeforeInterrupt.get())
    assertTrue(hooks.workerInterrupted.get())
    assertFalse(hooks.workerThread!!.isAlive)
    assertTrue(result.coordinatorInterrupted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `interrupted coordinator preserves returned control bytes without raster attempt`() {
    val hooks = BlockCompletionPublicationHooks(workerKind = "write", targetCompletion = 1)
    val socket = FakeSocket()
    val gate = NonReentrantTestGate()
    hooks.socketClosed = { socket.closeCalls > 0 }

    val result = interruptCoordinatorAfterCompletionCaptured(hooks) {
      transport(
        FakeSocketFactory(socket),
        gate = gate,
        workerHooks = hooks,
      ).print(ADDRESS, raster())
    }
    val error = result.failure as ThermalPrinterException
    val callsAtReturn = socket.writeCalls
    Thread.sleep(25)

    assertEquals(WRITE_FAILED_CODE, error.code)
    assertEquals("write", error.phase)
    assertTrue(error.cause is InterruptedException)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertEquals(0L, error.progress.bandsCompleted)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertEquals(1, callsAtReturn)
    assertEquals(callsAtReturn, socket.writeCalls)
    assertEquals(1, socket.closeCalls)
    assertTrue(hooks.closeObservedBeforeInterrupt.get())
    assertTrue(hooks.workerInterrupted.get())
    assertFalse(hooks.workerThread!!.isAlive)
    assertTrue(result.coordinatorInterrupted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `interrupted coordinator applies timeout policy to returned raster completion timestamp`() {
    val clock = FakeClock()
    val hooks = BlockCompletionPublicationHooks(workerKind = "write", targetCompletion = 2)
    var writeCalls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        writeCalls++
        if (writeCalls == 2) clock.advance(40)
      },
    )
    val gate = NonReentrantTestGate()
    hooks.socketClosed = { socket.closeCalls > 0 }

    val result = interruptCoordinatorAfterCompletionCaptured(hooks) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        gate = gate,
        workerHooks = hooks,
        config = shortTimeouts(write = 40),
      ).print(ADDRESS, raster())
    }
    val error = result.failure as ThermalPrinterException

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("write", error.phase)
    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
    assertEquals(1, socket.closeCalls)
    assertTrue(hooks.closeObservedBeforeInterrupt.get())
    assertTrue(hooks.workerInterrupted.get())
    assertFalse(hooks.workerThread!!.isAlive)
    assertTrue(result.coordinatorInterrupted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `job expiry before raster worker construction starts no worker or write`() {
    val clock = FakeClock()
    val hooks = ExpireWorkerHooks(
      clock = clock,
      expireAt = 100,
      stage = ExpireWorkerHooks.Stage.BEFORE_CONSTRUCTION,
      targetWrite = 2,
    )
    val socket = FakeSocket()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        workerHooks = hooks,
        config = shortTimeouts(write = 1_000, job = 100),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(1, socket.writeCalls)
    assertEquals(1, hooks.writeWorkerEntries)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `job expiry after worker construction skips worker start and write`() {
    val clock = FakeClock()
    val hooks = ExpireWorkerHooks(
      clock = clock,
      expireAt = 100,
      stage = ExpireWorkerHooks.Stage.BEFORE_START,
      targetWrite = 2,
    )
    val socket = FakeSocket()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        workerHooks = hooks,
        config = shortTimeouts(write = 1_000, job = 100),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(1, socket.writeCalls)
    assertEquals(1, hooks.writeWorkerEntries)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `job expiry inside started raster worker skips beforeOperation and write`() {
    val clock = FakeClock()
    val hooks = ExpireWorkerHooks(
      clock = clock,
      expireAt = 100,
      stage = ExpireWorkerHooks.Stage.INSIDE_WORKER,
      targetWrite = 2,
    )
    val socket = FakeSocket()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        workerHooks = hooks,
        config = shortTimeouts(write = 1_000, job = 100),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(1, socket.writeCalls)
    assertEquals(2, hooks.writeWorkerEntries)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `job expiry before secure connect worker starts closes without fallback`() {
    val clock = FakeClock()
    val socket = FakeSocket()
    val hooks = object : WorkerHooks {
      override fun afterInitialDeadlineCheck(workerKind: String) {
        if (workerKind == "connect") clock.advance(100)
      }
    }
    val factory = FakeSocketFactory(socket)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        factory,
        clock = clock,
        workerHooks = hooks,
        config = shortTimeouts(connect = 1_000, job = 100),
      ).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(0, socket.connectCalls)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `job deadline during connect is connect timeout with job phase and no fallback`() {
    val clock = FakeClock()
    val secure = FakeSocket(connectAction = { clock.advance(31) })
    val factory = FakeSocketFactory(secure)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        factory,
        clock = clock,
        config = shortTimeouts(connect = 100, job = 30),
      ).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
  }

  @Test
  fun `completed secure connect after phase timeout is still connect timeout`() {
    val clock = FakeClock()
    val secure = FakeSocket(connectAction = { clock.advance(41) })
    val factory = FakeSocketFactory(secure)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        factory,
        clock = clock,
        config = shortTimeouts(connect = 40, job = 5_000),
      ).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("connect", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
  }

  @Test
  fun `secure IOException after job deadline does not enable fallback`() {
    val clock = FakeClock()
    val secure = FakeSocket(
      connectAction = {
        clock.advance(31)
        throw IOException("late connect failure")
      },
    )
    val factory = FakeSocketFactory(secure)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        factory,
        clock = clock,
        config = shortTimeouts(connect = 100, job = 30),
      ).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
  }

  @Test
  fun `secure completion one millisecond before connect deadline wins despite delayed coordinator`() {
    val clock = CompletionClock(coordinatorAfterCompletion = 101)
    val secure = FakeSocket(
      connectAction = {
        clock.completeAt(99)
        throw IOException("connect failed before deadline")
      },
    )
    val insecure = FakeSocket()
    val factory = FakeSocketFactory(secure, insecure)

    transport(
      factory,
      clock = clock,
      config = shortTimeouts(connect = 100, job = 5_000),
    ).print(ADDRESS, raster())

    assertEquals(1, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
    assertEquals(1, insecure.connectCalls)
  }

  @Test
  fun `captured pre-deadline connect completion wins a coordinator cancellation race`() {
    val clock = CompletionClock(coordinatorAfterCompletion = 11)
    val hooks = BlockFirstConnectCompletionPublicationHooks()
    val secure = FakeSocket(
      connectAction = {
        clock.completeAt(9)
        throw IOException("secure connect failed before deadline")
      },
    )
    val insecure = FakeSocket()
    val factory = FakeSocketFactory(secure, insecure)

    transport(
      factory,
      clock = clock,
      workerHooks = hooks,
      config = shortTimeouts(connect = 10, job = 5_000),
    ).print(ADDRESS, raster())

    assertTrue(hooks.completionCaptured.await(1, TimeUnit.SECONDS))
    assertEquals(1, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
    assertEquals(1, insecure.connectCalls)
    assertFalse(hooks.wasInterrupted.get())
  }

  @Test
  fun `interrupted coordinator rejects a captured successful connect without continuing job`() {
    val hooks = BlockCompletionPublicationHooks(workerKind = "connect", targetCompletion = 1)
    val secure = FakeSocket()
    val factory = FakeSocketFactory(secure)
    val gate = NonReentrantTestGate()
    hooks.socketClosed = { secure.closeCalls > 0 }

    val result = interruptCoordinatorAfterCompletionCaptured(hooks) {
      transport(factory, gate = gate, workerHooks = hooks).print(ADDRESS, raster())
    }
    val error = result.failure as ThermalPrinterException

    assertEquals(CONNECT_FAILED_CODE, error.code)
    assertEquals("connect", error.phase)
    assertTrue(error.cause is InterruptedException)
    assertEquals(0, factory.insecureCreates)
    assertEquals(0, secure.writeCalls)
    assertEquals(1, secure.closeCalls)
    assertTrue(hooks.closeObservedBeforeInterrupt.get())
    assertTrue(hooks.workerInterrupted.get())
    assertFalse(hooks.workerThread!!.isAlive)
    assertTrue(result.coordinatorInterrupted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `coordinator interruption outranks captured secure IOException without fallback`() {
    val hooks = BlockCompletionPublicationHooks(workerKind = "connect", targetCompletion = 1)
    val original = IOException("secure failure captured before coordinator interruption")
    val secure = FakeSocket(connectAction = { throw original })
    val factory = FakeSocketFactory(secure)
    val gate = NonReentrantTestGate()
    hooks.socketClosed = { secure.closeCalls > 0 }

    val result = interruptCoordinatorAfterCompletionCaptured(hooks) {
      transport(factory, gate = gate, workerHooks = hooks).print(ADDRESS, raster())
    }
    val error = result.failure as ThermalPrinterException

    assertEquals(CONNECT_FAILED_CODE, error.code)
    assertEquals("connect", error.phase)
    assertTrue(error.cause is InterruptedException)
    assertFalse(error.cause === original)
    assertEquals(0, factory.insecureCreates)
    assertEquals(1, secure.closeCalls)
    assertTrue(hooks.closeObservedBeforeInterrupt.get())
    assertTrue(hooks.workerInterrupted.get())
    assertFalse(hooks.workerThread!!.isAlive)
    assertTrue(result.coordinatorInterrupted)
    assertFalse(gate.isHeld())
  }

  @Test
  fun `secure completion exactly at connect deadline is timeout without fallback`() {
    val clock = CompletionClock(coordinatorAfterCompletion = 101)
    val secure = FakeSocket(
      connectAction = {
        clock.completeAt(100)
        throw IOException("connect failed at deadline")
      },
    )
    val factory = FakeSocketFactory(secure)

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        factory,
        clock = clock,
        config = shortTimeouts(connect = 100, job = 5_000),
      ).print(ADDRESS, raster())
    }

    assertEquals(CONNECT_TIMEOUT_CODE, error.code)
    assertEquals("connect", error.phase)
    assertEquals(0, factory.insecureCreates)
  }

  @Test
  fun `job deadline during writing is write timeout with job phase and confirmed bytes`() {
    val clock = FakeClock()
    val socket = FakeSocket(writeAction = { _, _, _ -> clock.advance(6) })

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        config = shortTimeouts(write = 100, job = 5),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertEquals(0L, error.progress.bandsCompleted)
    assertFalse(error.progress.rasterPayloadAttempted)
  }

  @Test
  fun `band completed is confirmed before a job deadline observed after its final write`() {
    val clock = FakeClock()
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        if (calls == 2) clock.advance(6)
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        config = shortTimeouts(write = 100, job = 5),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
  }

  @Test
  fun `confirmed write one millisecond before idle deadline wins despite delayed coordinator`() {
    val clock = CompletionClock(coordinatorAfterCompletion = 101)
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        if (calls == 1) clock.completeAt(99)
      },
    )

    val result = transport(
      FakeSocketFactory(socket),
      clock = clock,
      config = shortTimeouts(write = 100, job = 5_000),
    ).print(ADDRESS, raster())

    assertEquals(14L, result.transportBytesWritten)
    assertEquals(1L, result.rasterBytesWritten)
    assertEquals(1L, result.bandsCompleted)
  }

  @Test
  fun `confirmed write exactly at idle deadline times out with confirmed progress`() {
    val clock = CompletionClock(coordinatorAfterCompletion = 101)
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        if (calls == 1) clock.completeAt(100)
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        config = shortTimeouts(write = 100, job = 5_000),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("write", error.phase)
    assertEquals(2L, error.progress.transportBytesWritten)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertFalse(error.progress.rasterPayloadAttempted)
  }

  @Test
  fun `idle budget is not rearmed after pacing before the next chunk`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        if (calls == 3) clock.advance(20)
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        clock = clock,
        pacer = pacer,
        config = shortTimeouts(write = 40, maxChunk = 8, chunkPacing = 30),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("write", error.phase)
    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertEquals(listOf(30L), pacer.delays)
  }

  @Test
  fun `write completion one millisecond before absolute idle boundary succeeds`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        if (calls == 3) clock.advance(9)
      },
    )

    val result = transport(
      FakeSocketFactory(socket),
      clock = clock,
      pacer = pacer,
      config = shortTimeouts(write = 40, maxChunk = 8, chunkPacing = 30),
    ).print(ADDRESS, raster())

    assertEquals(14L, result.transportBytesWritten)
  }

  @Test
  fun `confirmed control write resets idle deadline from its completion timestamp`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    var calls = 0
    val socket = FakeSocket(
      writeAction = { _, _, _ ->
        calls++
        when (calls) {
          2 -> clock.advance(20)
          3 -> clock.advance(5)
        }
      },
    )

    val result = transport(
      FakeSocketFactory(socket),
      clock = clock,
      pacer = pacer,
      config = shortTimeouts(write = 40, maxChunk = 8, chunkPacing = 30),
    ).print(ADDRESS, raster())

    assertEquals(14L, result.transportBytesWritten)
    assertEquals(55L, clock.nowMillis())
  }

  @Test
  fun `never writes a chunk larger than 2048 bytes`() {
    val socket = FakeSocket()
    val raster = MonochromeRaster(384, 100, ByteArray(48 * 100))

    transport(FakeSocketFactory(socket)).print(ADDRESS, raster)

    assertTrue(socket.writeSlices.all { it.size <= 2_048 })
    assertTrue(socket.writeSlices.any { it.size == 2_048 })
  }

  @Test
  fun `uses ten milliseconds within a band and forty only between lazy bands`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    val socket = FakeSocket()
    val config = shortTimeouts(
      write = 100,
      maxChunk = 5,
      chunkPacing = 10,
      bandPacing = 40,
    )

    transport(
      FakeSocketFactory(socket),
      encoder = EscPosRasterEncoder(bandRows = 1),
      clock = clock,
      pacer = pacer,
      config = config,
    ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(0x01, 0x02)))

    assertEquals(listOf(10L, 40L, 10L), pacer.delays)
    assertEquals(60L, clock.nowMillis())
  }

  @Test
  fun `writes initialize bands and feed four in order without cutter`() {
    val socket = FakeSocket()

    transport(
      FakeSocketFactory(socket),
      encoder = EscPosRasterEncoder(bandRows = 1),
    ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(0x01, 0x02)))

    assertArrayEquals(
      byteArrayOf(
        0x1B, 0x40,
        0x1D, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01,
        0x1D, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0x02,
        0x1B, 0x64, 0x04,
      ),
      socket.confirmedBytes(),
    )
  }

  @Test
  fun `ambiguous first raster write marks attempted but confirms no ambiguous bytes`() {
    val socket = FakeSocket(
      failWriteCall = 2,
      writeError = IOException("transmitted then failed"),
      recordAmbiguousWrite = true,
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(FakeSocketFactory(socket)).print(ADDRESS, raster(byteArrayOf(0x7F)))
    }

    assertTrue(socket.ambiguousBytes.isNotEmpty())
    assertEquals(2L, error.progress.transportBytesWritten)
    assertTrue(error.progress.rasterPayloadAttempted)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertEquals(0L, error.progress.bandsCompleted)
  }

  @Test
  fun `failure in header-only slice leaves raster payload unattempted`() {
    val socket = FakeSocket(failWriteCall = 2, writeError = IOException("header failed"))

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        config = shortTimeouts(maxChunk = 8),
      ).print(ADDRESS, raster())
    }

    assertEquals(2L, error.progress.transportBytesWritten)
    assertFalse(error.progress.rasterPayloadAttempted)
    assertEquals(0L, error.progress.rasterBytesWritten)
  }

  @Test
  fun `later band failure preserves exact completed band and byte counters`() {
    val socket = FakeSocket(failWriteCall = 3, writeError = IOException("second band failed"))

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        encoder = EscPosRasterEncoder(bandRows = 1),
      ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(0x01, 0x02)))
    }

    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
  }

  @Test
  fun `progress arithmetic saturates instead of overflowing`() {
    val almostMax = NativePrintProgress(
      transportBytesWritten = Long.MAX_VALUE - 1,
      rasterBytesWritten = Long.MAX_VALUE - 1,
      bandsCompleted = Long.MAX_VALUE,
      rasterPayloadAttempted = true,
    )

    val saturated = almostMax.afterConfirmedWrite(
      transportBytes = 10,
      rasterBytes = 10,
      completesBand = true,
    )

    assertEquals(Long.MAX_VALUE, saturated.transportBytesWritten)
    assertEquals(Long.MAX_VALUE, saturated.rasterBytesWritten)
    assertEquals(Long.MAX_VALUE, saturated.bandsCompleted)
  }

  @Test
  fun `coded printer error is a runtime transport error not an argument error`() {
    val cause = IOException("internal detail")
    val progress = NativePrintProgress(
      transportBytesWritten = 3,
      rasterBytesWritten = 1,
      bandsCompleted = 1,
      rasterPayloadAttempted = true,
    )

    val error = ThermalPrinterException(
      code = WRITE_FAILED_CODE,
      message = "Bluetooth write failed",
      phase = "write",
      progress = progress,
      cause = cause,
    )

    assertFalse(IllegalArgumentException::class.java.isAssignableFrom(error.javaClass))
    assertEquals(WRITE_FAILED_CODE, error.code)
    assertEquals("Bluetooth write failed", error.message)
    assertEquals("write", error.phase)
    assertEquals(progress, error.progress)
    assertEquals(cause, error.cause)
  }

  @Test
  fun `invalid raster and feed fail before gate discovery or socket creation`() {
    val factory = FakeSocketFactory(FakeSocket())
    val discovery = RecordingDiscoveryController()
    val gate = FakePrintGate()

    assertThrows(IllegalArgumentException::class.java) {
      transport(factory, discovery = discovery, gate = gate)
        .print(ADDRESS, MonochromeRaster(9, 1, ByteArray(1)))
    }
    assertThrows(IllegalArgumentException::class.java) {
      transport(factory, discovery = discovery, gate = gate).print(ADDRESS, raster(), feedLines = 256)
    }

    assertEquals(0, gate.acquireCalls)
    assertEquals(0, discovery.calls)
    assertEquals(0, factory.secureCreates)
  }

  @Test
  fun `job deadline also covers pacing`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    val socket = FakeSocket()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        encoder = EscPosRasterEncoder(bandRows = 1),
        clock = clock,
        pacer = pacer,
        config = shortTimeouts(job = 30, bandPacing = 40),
      ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(1, 2)))
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(11L, error.progress.transportBytesWritten)
    assertEquals(1L, error.progress.rasterBytesWritten)
    assertEquals(1L, error.progress.bandsCompleted)
    assertEquals(listOf(30L), pacer.delays)
  }

  @Test
  fun `pacing is capped by remaining job budget and never starts next band`() {
    val clock = FakeClock()
    val pacer = RecordingPacer(clock)
    val socket = FakeSocket()

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        encoder = EscPosRasterEncoder(bandRows = 1),
        clock = clock,
        pacer = pacer,
        config = shortTimeouts(write = 100, job = 30, bandPacing = 40),
      ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(1, 2)))
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
    assertEquals(listOf(30L), pacer.delays)
    assertEquals(2, socket.writeCalls)
    assertEquals(1, socket.closeCalls)
  }

  @Test
  fun `pacer exception after deadline is classified as timeout`() {
    val clock = FakeClock()
    val pacer = Pacer { millis ->
      clock.advance(millis)
      throw IOException("pacer failed after sleep")
    }

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(FakeSocket()),
        encoder = EscPosRasterEncoder(bandRows = 1),
        clock = clock,
        pacer = pacer,
        config = shortTimeouts(write = 100, job = 30, bandPacing = 40),
      ).print(ADDRESS, MonochromeRaster(8, 2, byteArrayOf(1, 2)))
    }

    assertEquals(WRITE_TIMEOUT_CODE, error.code)
    assertEquals("job", error.phase)
  }

  @Test
  fun `API 31 discovery policy never queries or cancels discovery`() {
    val adapter = FakeLegacyDiscoveryAdapter(discovering = true)

    AndroidDiscoveryController(
      sdkInt = { 31 },
      hasLegacyBluetoothPermission = { throw AssertionError("permission must not be queried") },
      adapter = adapter,
    ).cancelDiscoveryIfNeeded()

    assertEquals(0, adapter.queryCalls)
    assertEquals(0, adapter.cancelCalls)
  }

  @Test
  fun `legacy discovery policy does nothing without legacy permission`() {
    val adapter = FakeLegacyDiscoveryAdapter(discovering = true)

    AndroidDiscoveryController(
      sdkInt = { 30 },
      hasLegacyBluetoothPermission = { false },
      adapter = adapter,
    ).cancelDiscoveryIfNeeded()

    assertEquals(0, adapter.queryCalls)
    assertEquals(0, adapter.cancelCalls)
  }

  @Test
  fun `legacy discovery policy queries once and cancels only when already active`() {
    val inactive = FakeLegacyDiscoveryAdapter(discovering = false)
    val active = FakeLegacyDiscoveryAdapter(discovering = true)

    AndroidDiscoveryController({ 30 }, { true }, inactive).cancelDiscoveryIfNeeded()
    AndroidDiscoveryController({ 30 }, { true }, active).cancelDiscoveryIfNeeded()

    assertEquals(1, inactive.queryCalls)
    assertEquals(0, inactive.cancelCalls)
    assertEquals(1, active.queryCalls)
    assertEquals(1, active.cancelCalls)
  }

  @Test
  fun `all coded write failures expose immutable four-field progress`() {
    val socket = FakeSocket(failWriteCall = 3, writeError = SecurityException("revoked"))

    val error = assertThrows(ThermalPrinterException::class.java) {
      transport(
        FakeSocketFactory(socket),
        config = shortTimeouts(maxChunk = 8),
      ).print(ADDRESS, raster())
    }

    assertEquals(WRITE_FAILED_CODE, error.code)
    assertNotNull(error.progress)
    assertEquals(10L, error.progress.transportBytesWritten)
    assertEquals(0L, error.progress.rasterBytesWritten)
    assertEquals(0L, error.progress.bandsCompleted)
    assertTrue(error.progress.rasterPayloadAttempted)
  }

  private fun transport(
    factory: PrinterSocketFactory,
    discovery: DiscoveryController = RecordingDiscoveryController(),
    gate: PrintGate = FakePrintGate(),
    encoder: EscPosRasterEncoder = EscPosRasterEncoder(),
    clock: MonotonicClock = FakeClock(),
    pacer: Pacer = NoOpPacer,
    config: BluetoothTransportConfig = shortTimeouts(),
    workerHooks: WorkerHooks = NoOpWorkerHooks,
  ): BluetoothPrinterTransport = BluetoothPrinterTransport(
    socketFactory = factory,
    discoveryController = discovery,
    gate = gate,
    encoder = encoder,
    clock = clock,
    pacer = pacer,
    config = config,
    workerHooks = workerHooks,
  )

  private fun interruptCoordinatorAfterCompletionCaptured(
    hooks: BlockCompletionPublicationHooks,
    action: () -> Unit,
  ): InterruptedCoordinatorResult {
    val failure = AtomicReference<Throwable?>(null)
    val coordinatorInterrupted = AtomicBoolean()
    val coordinator = Thread {
      try {
        action()
      } catch (caught: Throwable) {
        failure.set(caught)
      } finally {
        coordinatorInterrupted.set(Thread.currentThread().isInterrupted)
      }
    }.apply { isDaemon = true }

    coordinator.start()
    assertTrue(hooks.completionCaptured.await(1, TimeUnit.SECONDS))
    coordinator.interrupt()
    coordinator.join(2_000)
    assertFalse(coordinator.isAlive)
    assertNotNull(failure.get())
    return InterruptedCoordinatorResult(failure.get(), coordinatorInterrupted.get())
  }

  private fun shortTimeouts(
    connect: Long = 40,
    write: Long = 40,
    job: Long = 5_000,
    maxChunk: Int = 2_048,
    chunkPacing: Long = 0,
    bandPacing: Long = 0,
  ) = BluetoothTransportConfig(
    connectTimeoutMillis = connect,
    writeIdleTimeoutMillis = write,
    jobDeadlineMillis = job,
    maxChunkBytes = maxChunk,
    chunkPacingMillis = chunkPacing,
    bandPacingMillis = bandPacing,
  )

  private fun raster(bytes: ByteArray = byteArrayOf(0x01)): MonochromeRaster =
    MonochromeRaster(width = bytes.size * 8, height = 1, bytes = bytes)

  private fun assertZeroProgress(progress: NativePrintProgress) {
    assertEquals(0L, progress.transportBytesWritten)
    assertEquals(0L, progress.rasterBytesWritten)
    assertEquals(0L, progress.bandsCompleted)
    assertFalse(progress.rasterPayloadAttempted)
  }

  private class FakeClock : MonotonicClock {
    private val time = AtomicLong()

    override fun nowMillis(): Long = time.get()

    fun advance(millis: Long) {
      time.addAndGet(millis)
    }
  }

  private object RealTestClock : MonotonicClock {
    override fun nowMillis(): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())
  }

  private class RecordingPacer(private val clock: FakeClock) : Pacer {
    val delays = mutableListOf<Long>()

    override fun pause(millis: Long) {
      delays += millis
      clock.advance(millis)
    }
  }

  private object NoOpPacer : Pacer {
    override fun pause(millis: Long) = Unit
  }

  private object NoOpWorkerHooks : WorkerHooks

  private class BlockCompletionPublicationHooks(
    private val workerKind: String,
    private val targetCompletion: Long,
  ) : WorkerHooks {
    val completionCaptured = CountDownLatch(1)
    val closeObservedBeforeInterrupt = AtomicBoolean()
    val workerInterrupted = AtomicBoolean()
    private val completions = AtomicLong()
    private val neverRelease = CountDownLatch(1)
    var socketClosed: () -> Boolean = { false }
    @Volatile var workerThread: Thread? = null

    override fun afterOperationCompletionCaptured(workerKind: String) {
      if (workerKind != this.workerKind || completions.incrementAndGet() != targetCompletion) return
      workerThread = Thread.currentThread()
      completionCaptured.countDown()
      try {
        neverRelease.await()
      } catch (_: InterruptedException) {
        closeObservedBeforeInterrupt.set(socketClosed())
        workerInterrupted.set(true)
        Thread.currentThread().interrupt()
      }
    }
  }

  private data class InterruptedCoordinatorResult(
    val failure: Throwable?,
    val coordinatorInterrupted: Boolean,
  )

  private class BlockFirstConnectCompletionPublicationHooks : WorkerHooks {
    val completionCaptured = CountDownLatch(1)
    private val connectCompletions = AtomicLong()
    val wasInterrupted = AtomicBoolean()

    override fun afterOperationCompletionCaptured(workerKind: String) {
      if (workerKind != "connect" || connectCompletions.incrementAndGet() != 1L) return
      completionCaptured.countDown()
      try {
        Thread.sleep(50)
      } catch (_: InterruptedException) {
        wasInterrupted.set(true)
        Thread.currentThread().interrupt()
      }
    }
  }

  private class ExpireWorkerHooks(
    private val clock: FakeClock,
    private val expireAt: Long,
    private val stage: Stage,
    private val targetWrite: Int,
  ) : WorkerHooks {
    private var constructionWriteCalls = 0
    private var startWriteCalls = 0
    var writeWorkerEntries = 0

    override fun afterInitialDeadlineCheck(workerKind: String) {
      if (workerKind != "write") return
      constructionWriteCalls++
      if (stage == Stage.BEFORE_CONSTRUCTION && constructionWriteCalls == targetWrite) {
        clock.advance(expireAt - clock.nowMillis())
      }
    }

    override fun beforeWorkerStartDeadlineCheck(workerKind: String) {
      if (workerKind != "write") return
      startWriteCalls++
      if (stage == Stage.BEFORE_START && startWriteCalls == targetWrite) {
        clock.advance(expireAt - clock.nowMillis())
      }
    }

    override fun beforeOperationDeadlineCheck(workerKind: String) {
      if (workerKind != "write") return
      writeWorkerEntries++
      if (stage == Stage.INSIDE_WORKER && writeWorkerEntries == targetWrite) {
        clock.advance(expireAt - clock.nowMillis())
      }
    }

    enum class Stage {
      BEFORE_CONSTRUCTION,
      BEFORE_START,
      INSIDE_WORKER,
    }
  }

  private class CompletionClock(
    private val coordinatorAfterCompletion: Long,
  ) : MonotonicClock {
    private val current = AtomicLong()
    @Volatile private var operationCompleted = false

    override fun nowMillis(): Long {
      if (operationCompleted && !Thread.currentThread().name.startsWith("thermal-printer-")) {
        current.updateAndGet { maxOf(it, coordinatorAfterCompletion) }
      }
      return current.get()
    }

    fun completeAt(millis: Long) {
      current.set(millis)
      operationCompleted = true
    }
  }

  private open class FakeSocket(
    private val events: MutableList<String> = mutableListOf(),
    private val label: String = "socket",
    private val connectAction: () -> Unit = {},
    private val writeAction: (ByteArray, Int, Int) -> Unit = { _, _, _ -> },
    private val failWriteCall: Int? = null,
    private val writeError: Throwable = IOException("write failed"),
    private val recordAmbiguousWrite: Boolean = false,
  ) : PrinterSocket {
    var connectCalls = 0
    var writeCalls = 0
    var closeCalls = 0
    val writeSlices = mutableListOf<ByteArray>()
    val confirmedSlices = mutableListOf<ByteArray>()
    val ambiguousBytes = mutableListOf<Byte>()

    override fun connect() {
      connectCalls++
      events += "$label.connect"
      connectAction()
    }

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
      writeCalls++
      val slice = buffer.copyOfRange(offset, offset + length)
      writeSlices += slice
      if (failWriteCall == writeCalls) {
        if (recordAmbiguousWrite) ambiguousBytes += slice.toList()
        throw writeError
      }
      writeAction(buffer, offset, length)
      confirmedSlices += slice
    }

    override fun close() {
      closeCalls++
      events += "$label.close"
    }

    fun confirmedBytes(): ByteArray = confirmedSlices.flatMap { it.toList() }.toByteArray()
  }

  private class BlockingConnectSocket : PrinterSocket {
    private val release = CountDownLatch(1)
    var workerThread: Thread? = null
    var closeCalls = 0

    override fun connect() {
      workerThread = Thread.currentThread()
      try {
        release.await(5, TimeUnit.SECONDS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }

    override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit

    override fun close() {
      closeCalls++
      release.countDown()
    }
  }

  private class BlockingWriteSocket : PrinterSocket {
    private val release = CountDownLatch(1)
    var workerThread: Thread? = null
    var writeCalls = 0
    var closeCalls = 0

    override fun connect() = Unit

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
      writeCalls++
      workerThread = Thread.currentThread()
      try {
        release.await(5, TimeUnit.SECONDS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }

    override fun close() {
      closeCalls++
      release.countDown()
    }
  }

  private class ManuallyBlockedConnectSocket : PrinterSocket {
    val started = CountDownLatch(1)
    private val allowed = CountDownLatch(1)
    var closeCalls = 0

    override fun connect() {
      started.countDown()
      allowed.await(2, TimeUnit.SECONDS)
    }

    override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit

    override fun close() {
      closeCalls++
      allowed.countDown()
    }

    fun allowConnect() = allowed.countDown()
  }

  private class FakeSocketFactory(
    private val secureSocket: PrinterSocket,
    private val insecureSocket: PrinterSocket = FakeSocket(),
    private val events: MutableList<String> = mutableListOf(),
    private val secureFactoryError: Throwable? = null,
  ) : PrinterSocketFactory {
    var secureCreates = 0
    var insecureCreates = 0
    val secureUuids = mutableListOf<UUID>()

    override fun createSecure(address: String, serviceUuid: UUID): PrinterSocket {
      secureCreates++
      secureUuids += serviceUuid
      events += "factory.secure"
      secureFactoryError?.let { throw it }
      return secureSocket
    }

    override fun createInsecure(address: String, serviceUuid: UUID): PrinterSocket {
      insecureCreates++
      events += "factory.insecure"
      return insecureSocket
    }
  }

  private class RecordingDiscoveryController : DiscoveryController {
    var calls = 0

    override fun cancelDiscoveryIfNeeded() {
      calls++
    }
  }

  private class FakePrintGate(private val acquire: Boolean = true) : PrintGate {
    var acquireCalls = 0
    var releaseCalls = 0

    override fun tryAcquire(): Boolean {
      acquireCalls++
      return acquire
    }

    override fun release() {
      releaseCalls++
    }
  }

  private class NonReentrantTestGate : PrintGate {
    private val held = AtomicBoolean()

    override fun tryAcquire(): Boolean = held.compareAndSet(false, true)

    override fun release() {
      check(held.compareAndSet(true, false))
    }

    fun isHeld(): Boolean = held.get()
  }

  private class FakeLegacyDiscoveryAdapter(private val discovering: Boolean) : LegacyDiscoveryAdapter {
    var queryCalls = 0
    var cancelCalls = 0

    override fun isDiscovering(): Boolean {
      queryCalls++
      return discovering
    }

    override fun cancelDiscovery() {
      cancelCalls++
    }
  }

  private companion object {
    const val ADDRESS = "01:23:45:67:89:AB"
  }
}
