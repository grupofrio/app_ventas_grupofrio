package mx.grupofrio.thermalprinter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BluetoothStateTest {
  @Test
  fun `no adapter is unsupported without checking connect permission`() {
    val access = FakeBluetoothAccess(sdk = 31, connectPermission = false)
    val directory = directory(adapter = null, access = access)

    assertEquals(BluetoothState.UNSUPPORTED, directory.getBluetoothState())
    assertEquals("unsupported", directory.getBluetoothState().wireValue)
    assertEquals(0, access.permissionChecks)
  }

  @Test
  fun `API 31 missing connect permission fails before every protected adapter read`() {
    val adapter = FakeBluetoothAdapter(enabled = true)
    val access = FakeBluetoothAccess(sdk = 31, connectPermission = false)

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter, access).getBluetoothState()
    }

    assertEquals(PERMISSION_DENIED_CODE, error.code)
    assertEquals("Bluetooth permission denied", error.message)
    assertZeroProgress(error)
    assertEquals(1, access.permissionChecks)
    assertEquals(0, adapter.enabledReads)
    assertEquals(0, adapter.bondedReads)
  }

  @Test
  fun `disabled and enabled adapters map to exact off and on wire states`() {
    val disabled = directory(FakeBluetoothAdapter(enabled = false), FakeBluetoothAccess(31, true))
    val enabled = directory(FakeBluetoothAdapter(enabled = true), FakeBluetoothAccess(31, true))

    assertEquals(BluetoothState.OFF, disabled.getBluetoothState())
    assertEquals("off", disabled.getBluetoothState().wireValue)
    assertEquals(BluetoothState.ON, enabled.getBluetoothState())
    assertEquals("on", enabled.getBluetoothState().wireValue)
  }

  @Test
  fun `unexpected SecurityException reading adapter state is a safe permission error`() {
    val adapter = FakeBluetoothAdapter(
      enabled = true,
      enabledError = SecurityException("sensitive Android permission detail"),
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter, FakeBluetoothAccess(31, true)).getBluetoothState()
    }

    assertEquals(PERMISSION_DENIED_CODE, error.code)
    assertEquals("Bluetooth permission denied", error.message)
    assertEquals(false, error.message!!.contains("sensitive"))
    assertZeroProgress(error)
    assertEquals(1, adapter.enabledReads)
    assertEquals(0, adapter.bondedReads)
  }

  private fun directory(
    adapter: BluetoothAdapterFacade?,
    access: BluetoothAccessChecker,
  ) = BluetoothDeviceDirectory(
    adapterProvider = BluetoothAdapterProvider { adapter },
    accessChecker = access,
    discoveryController = DiscoveryController { },
  )

  private fun assertZeroProgress(error: ThermalPrinterException) {
    assertEquals(NativePrintProgress(), error.progress)
  }

  private class FakeBluetoothAccess(
    private val sdk: Int,
    private val connectPermission: Boolean,
  ) : BluetoothAccessChecker {
    var permissionChecks = 0

    override fun sdkInt(): Int = sdk

    override fun hasBluetoothConnectPermission(): Boolean {
      permissionChecks++
      return connectPermission
    }
  }

  private class FakeBluetoothAdapter(
    private val enabled: Boolean,
    private val enabledError: SecurityException? = null,
  ) : BluetoothAdapterFacade {
    var enabledReads = 0
    var bondedReads = 0

    override fun isEnabled(): Boolean {
      enabledReads++
      enabledError?.let { throw it }
      return enabled
    }

    override fun bondedDevices(): Set<BondedBluetoothDeviceFacade> {
      bondedReads++
      return emptySet()
    }
  }
}
