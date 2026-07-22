package mx.grupofrio.thermalprinter

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BluetoothDeviceDirectoryTest {
  @Test
  fun `listing unsupported adapter returns coded zero-progress error without permission check`() {
    val access = FakeBluetoothAccess(sdk = 31, connectPermission = false)

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter = null, access = access).getBondedDevices()
    }

    assertEquals(BLUETOOTH_UNSUPPORTED_CODE, error.code)
    assertEquals("Bluetooth is unavailable", error.message)
    assertZeroProgress(error)
    assertEquals(0, access.permissionChecks)
  }

  @Test
  fun `API 31 missing permission precedes enabled bonded discovery and device reads`() {
    val device = MutableDevice("MP210", "AA:00")
    val adapter = FakeBluetoothAdapter(enabled = true, devices = linkedSetOf(device))
    val access = FakeBluetoothAccess(sdk = 31, connectPermission = false)
    val discovery = RecordingDiscoveryController()

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter, access, discovery).getBondedDevices()
    }

    assertEquals(PERMISSION_DENIED_CODE, error.code)
    assertZeroProgress(error)
    assertEquals(1, access.permissionChecks)
    assertEquals(0, adapter.enabledReads)
    assertEquals(0, adapter.bondedReads)
    assertEquals(0, discovery.calls)
    assertEquals(0, device.nameReads)
    assertEquals(0, device.addressReads)
  }

  @Test
  fun `disabled adapter returns coded zero-progress error before discovery or bonded read`() {
    val adapter = FakeBluetoothAdapter(enabled = false)
    val discovery = RecordingDiscoveryController()

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter, discovery = discovery).getBondedDevices()
    }

    assertEquals(BLUETOOTH_DISABLED_CODE, error.code)
    assertEquals("Bluetooth is turned off", error.message)
    assertZeroProgress(error)
    assertEquals(1, adapter.enabledReads)
    assertEquals(0, adapter.bondedReads)
    assertEquals(0, discovery.calls)
  }

  @Test
  fun `listing returns only the injected bonded snapshot`() {
    val bonded = MutableDevice("Paired", "AA:01")
    val adapter = FakeBluetoothAdapter(enabled = true, devices = linkedSetOf(bonded))

    val result = directory(adapter).getBondedDevices()

    assertEquals(listOf(BondedBluetoothDevice("Paired", "AA:01")), result)
    assertEquals(1, adapter.bondedReads)
    assertEquals(1, bonded.nameReads)
    assertEquals(1, bonded.addressReads)
  }

  @Test
  fun `sorting ranks trimmed case-insensitive MP210 then root-case names nulls and address`() {
    val devices = linkedSetOf<BondedBluetoothDeviceFacade>(
      MutableDevice(null, "AA:00"),
      MutableDevice("zeta", "AA:09"),
      MutableDevice("alpha", "AA:04"),
      MutableDevice("ALPHA", "AA:03"),
      MutableDevice("mp210", "AA:02"),
      MutableDevice(" MP210 ", "AA:05"),
      MutableDevice("MP210", "AA:01"),
      MutableDevice(null, "AA:08"),
      MutableDevice("same", "AA:07"),
      MutableDevice("SAME", "AA:06"),
    )

    val result = directory(FakeBluetoothAdapter(true, devices)).getBondedDevices()

    assertEquals(
      listOf(
        BondedBluetoothDevice(" MP210 ", "AA:05"),
        BondedBluetoothDevice("MP210", "AA:01"),
        BondedBluetoothDevice("mp210", "AA:02"),
        BondedBluetoothDevice("ALPHA", "AA:03"),
        BondedBluetoothDevice("alpha", "AA:04"),
        BondedBluetoothDevice("SAME", "AA:06"),
        BondedBluetoothDevice("same", "AA:07"),
        BondedBluetoothDevice("zeta", "AA:09"),
        BondedBluetoothDevice(null, "AA:00"),
        BondedBluetoothDevice(null, "AA:08"),
      ),
      result,
    )
  }

  @Test
  fun `name ordering uses Locale ROOT instead of the process locale`() {
    val originalLocale = Locale.getDefault()
    try {
      Locale.setDefault(Locale("tr", "TR"))
      val devices = linkedSetOf<BondedBluetoothDeviceFacade>(
        MutableDevice("izmir", "AA:02"),
        MutableDevice("Ibis", "AA:01"),
      )

      val result = directory(FakeBluetoothAdapter(true, devices)).getBondedDevices()

      assertEquals(
        listOf(
          BondedBluetoothDevice("Ibis", "AA:01"),
          BondedBluetoothDevice("izmir", "AA:02"),
        ),
        result,
      )
    } finally {
      Locale.setDefault(originalLocale)
    }
  }

  @Test
  fun `snapshot reads getters once preserves raw address and is defensively immutable`() {
    val first = MutableDevice("Stable", "")
    val second = MutableDevice(null, "AA:02")
    val source = linkedSetOf<BondedBluetoothDeviceFacade>(first, second)
    val result = directory(FakeBluetoothAdapter(true, source)).getBondedDevices()

    first.name = "Changed"
    first.address = "CHANGED"
    source.clear()

    assertEquals(
      listOf(BondedBluetoothDevice("Stable", ""), BondedBluetoothDevice(null, "AA:02")),
      result,
    )
    assertEquals(1, first.nameReads)
    assertEquals(1, first.addressReads)
    assertEquals(1, second.nameReads)
    assertEquals(1, second.addressReads)
    @Suppress("UNCHECKED_CAST")
    val mutableView = result as MutableList<BondedBluetoothDevice>
    assertThrows(UnsupportedOperationException::class.java) {
      mutableView.add(BondedBluetoothDevice("Injected", "AA:03"))
    }
  }

  @Test
  fun `unexpected SecurityException from bonded adapter read is safe permission denied`() {
    val adapter = FakeBluetoothAdapter(
      enabled = true,
      bondedError = SecurityException("private adapter details"),
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter).getBondedDevices()
    }

    assertSafePermissionError(error)
    assertEquals(1, adapter.enabledReads)
    assertEquals(1, adapter.bondedReads)
  }

  @Test
  fun `unexpected SecurityException from device getter stops further reads safely`() {
    val nameFailure = MutableDevice(
      name = "Hidden",
      address = "AA:01",
      nameError = SecurityException("private device name"),
    )
    val nameError = assertThrows(ThermalPrinterException::class.java) {
      directory(FakeBluetoothAdapter(true, linkedSetOf(nameFailure))).getBondedDevices()
    }

    assertSafePermissionError(nameError)
    assertEquals(1, nameFailure.nameReads)
    assertEquals(0, nameFailure.addressReads)

    val addressFailure = MutableDevice(
      name = "Visible",
      address = "AA:02",
      addressError = SecurityException("private device address"),
    )
    val addressError = assertThrows(ThermalPrinterException::class.java) {
      directory(FakeBluetoothAdapter(true, linkedSetOf(addressFailure))).getBondedDevices()
    }

    assertSafePermissionError(addressError)
    assertEquals(1, addressFailure.nameReads)
    assertEquals(1, addressFailure.addressReads)
  }

  @Test
  fun `SecurityException from discovery policy is safe permission denied before bonded read`() {
    val adapter = FakeBluetoothAdapter(enabled = true)
    val discovery = DiscoveryController { throw SecurityException("legacy permission details") }

    val error = assertThrows(ThermalPrinterException::class.java) {
      directory(adapter, discovery = discovery).getBondedDevices()
    }

    assertSafePermissionError(error)
    assertEquals(1, adapter.enabledReads)
    assertEquals(0, adapter.bondedReads)
  }

  @Test
  fun `API 31 shared discovery policy never checks legacy permission queries or cancels`() {
    val legacy = FakeLegacyDiscoveryAdapter(discovering = true)
    val adapter = FakeBluetoothAdapter(enabled = true)
    val discovery = AndroidDiscoveryController(
      sdkInt = { 31 },
      hasLegacyBluetoothPermission = { throw AssertionError("legacy permission must not be queried") },
      adapter = legacy,
    )

    assertEquals(emptyList<BondedBluetoothDevice>(), directory(adapter, discovery = discovery).getBondedDevices())
    assertEquals(0, legacy.queryCalls)
    assertEquals(0, legacy.cancelCalls)
    assertEquals(1, adapter.bondedReads)
  }

  @Test
  fun `legacy shared discovery policy skips query without admin permission`() {
    val legacy = FakeLegacyDiscoveryAdapter(discovering = true)
    val discovery = AndroidDiscoveryController(
      sdkInt = { 30 },
      hasLegacyBluetoothPermission = { false },
      adapter = legacy,
    )

    directory(FakeBluetoothAdapter(true), FakeBluetoothAccess(30, false), discovery)
      .getBondedDevices()

    assertEquals(0, legacy.queryCalls)
    assertEquals(0, legacy.cancelCalls)
  }

  @Test
  fun `legacy shared discovery policy queries once and cancels only when active`() {
    val inactive = FakeLegacyDiscoveryAdapter(discovering = false)
    val active = FakeLegacyDiscoveryAdapter(discovering = true)

    directory(
      FakeBluetoothAdapter(true),
      FakeBluetoothAccess(30, false),
      AndroidDiscoveryController({ 30 }, { true }, inactive),
    ).getBondedDevices()
    directory(
      FakeBluetoothAdapter(true),
      FakeBluetoothAccess(30, false),
      AndroidDiscoveryController({ 30 }, { true }, active),
    ).getBondedDevices()

    assertEquals(1, inactive.queryCalls)
    assertEquals(0, inactive.cancelCalls)
    assertEquals(1, active.queryCalls)
    assertEquals(1, active.cancelCalls)
  }

  private fun directory(
    adapter: BluetoothAdapterFacade?,
    access: BluetoothAccessChecker = FakeBluetoothAccess(31, true),
    discovery: DiscoveryController = RecordingDiscoveryController(),
  ) = BluetoothDeviceDirectory(
    adapterProvider = BluetoothAdapterProvider { adapter },
    accessChecker = access,
    discoveryController = discovery,
  )

  private fun assertSafePermissionError(error: ThermalPrinterException) {
    assertEquals(PERMISSION_DENIED_CODE, error.code)
    assertEquals("Bluetooth permission denied", error.message)
    assertEquals(false, error.message!!.contains("private"))
    assertZeroProgress(error)
  }

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
    private val devices: Set<BondedBluetoothDeviceFacade> = emptySet(),
    private val bondedError: SecurityException? = null,
  ) : BluetoothAdapterFacade {
    var enabledReads = 0
    var bondedReads = 0

    override fun isEnabled(): Boolean {
      enabledReads++
      return enabled
    }

    override fun bondedDevices(): Set<BondedBluetoothDeviceFacade> {
      bondedReads++
      bondedError?.let { throw it }
      return devices
    }
  }

  private class MutableDevice(
    var name: String?,
    var address: String,
    private val nameError: SecurityException? = null,
    private val addressError: SecurityException? = null,
  ) : BondedBluetoothDeviceFacade {
    var nameReads = 0
    var addressReads = 0

    override fun name(): String? {
      nameReads++
      nameError?.let { throw it }
      return name
    }

    override fun address(): String {
      addressReads++
      addressError?.let { throw it }
      return address
    }
  }

  private class RecordingDiscoveryController : DiscoveryController {
    var calls = 0

    override fun cancelDiscoveryIfNeeded() {
      calls++
    }
  }

  private class FakeLegacyDiscoveryAdapter(
    private val discovering: Boolean,
  ) : LegacyDiscoveryAdapter {
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
}
