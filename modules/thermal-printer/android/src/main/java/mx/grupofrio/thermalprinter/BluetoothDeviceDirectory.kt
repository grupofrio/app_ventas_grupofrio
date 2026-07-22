package mx.grupofrio.thermalprinter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.util.Collections
import java.util.Locale

internal enum class BluetoothState(val wireValue: String) {
  UNSUPPORTED("unsupported"),
  OFF("off"),
  ON("on"),
}

internal data class BondedBluetoothDevice(
  val name: String?,
  val address: String,
)

internal fun interface BluetoothAdapterProvider {
  fun adapter(): BluetoothAdapterFacade?
}

internal interface BluetoothAdapterFacade {
  fun isEnabled(): Boolean

  fun bondedDevices(): Set<BondedBluetoothDeviceFacade>
}

internal interface BondedBluetoothDeviceFacade {
  fun name(): String?

  fun address(): String
}

internal interface BluetoothAccessChecker {
  fun sdkInt(): Int

  fun hasBluetoothConnectPermission(): Boolean
}

internal class BluetoothDeviceDirectory internal constructor(
  private val adapterProvider: BluetoothAdapterProvider,
  private val accessChecker: BluetoothAccessChecker,
  private val discoveryController: DiscoveryController,
) {
  private constructor(dependencies: AndroidBluetoothDependencies) : this(
    adapterProvider = dependencies.adapterProvider,
    accessChecker = dependencies.accessChecker,
    discoveryController = dependencies.discoveryController,
  )

  constructor(context: Context) : this(androidBluetoothDependencies(context.applicationContext))

  fun getBluetoothState(): BluetoothState {
    val adapter = adapterProvider.adapter() ?: return BluetoothState.UNSUPPORTED
    requireConnectPermissionIfNeeded()
    return protectedRead {
      if (adapter.isEnabled()) BluetoothState.ON else BluetoothState.OFF
    }
  }

  fun getBondedDevices(): List<BondedBluetoothDevice> {
    val adapter = adapterProvider.adapter() ?: throw bluetoothUnsupported()
    requireConnectPermissionIfNeeded()
    val enabled = protectedRead { adapter.isEnabled() }
    if (!enabled) throw bluetoothDisabled()

    protectedRead { discoveryController.cancelDiscoveryIfNeeded() }
    val snapshots = protectedRead {
      adapter.bondedDevices().map { device ->
        val name = device.name()
        val address = device.address()
        BondedBluetoothDevice(name = name, address = address)
      }
    }
    return Collections.unmodifiableList(snapshots.sortedWith(BONDED_DEVICE_COMPARATOR))
  }

  private fun requireConnectPermissionIfNeeded() {
    if (
      accessChecker.sdkInt() >= Build.VERSION_CODES.S &&
      !accessChecker.hasBluetoothConnectPermission()
    ) {
      throw permissionDenied()
    }
  }

  private fun <Result> protectedRead(block: () -> Result): Result = try {
    block()
  } catch (error: SecurityException) {
    throw permissionDenied(error)
  }

  private companion object {
    val BONDED_DEVICE_COMPARATOR = compareBy<BondedBluetoothDevice>(
      { device -> if (device.name?.trim()?.contains("MP210", ignoreCase = true) == true) 0 else 1 },
      { device -> device.name == null },
      { device -> device.name?.lowercase(Locale.ROOT) ?: "" },
      { device -> device.address },
    )
  }
}

private class AndroidBluetoothAdapterFacade(
  private val adapter: BluetoothAdapter,
) : BluetoothAdapterFacade, LegacyDiscoveryAdapter {
  override fun isEnabled(): Boolean = adapter.isEnabled

  override fun bondedDevices(): Set<BondedBluetoothDeviceFacade> =
    adapter.bondedDevices.mapTo(linkedSetOf(), ::AndroidBondedBluetoothDeviceFacade)

  override fun isDiscovering(): Boolean = adapter.isDiscovering

  override fun cancelDiscovery() {
    adapter.cancelDiscovery()
  }
}

private class AndroidBondedBluetoothDeviceFacade(
  private val device: BluetoothDevice,
) : BondedBluetoothDeviceFacade {
  override fun name(): String? = device.name

  override fun address(): String = device.address
}

private class AndroidBluetoothAccessChecker(
  private val context: Context,
) : BluetoothAccessChecker {
  override fun sdkInt(): Int = Build.VERSION.SDK_INT

  override fun hasBluetoothConnectPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED
}

private data class AndroidBluetoothDependencies(
  val adapterProvider: BluetoothAdapterProvider,
  val accessChecker: BluetoothAccessChecker,
  val discoveryController: DiscoveryController,
)

private fun androidBluetoothDependencies(context: Context): AndroidBluetoothDependencies {
  val adapter = context.bluetoothAdapter()?.let(::AndroidBluetoothAdapterFacade)
  return AndroidBluetoothDependencies(
    adapterProvider = BluetoothAdapterProvider { adapter },
    accessChecker = AndroidBluetoothAccessChecker(context),
    discoveryController = AndroidDiscoveryController(
      sdkInt = { Build.VERSION.SDK_INT },
      hasLegacyBluetoothPermission = {
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADMIN) ==
          PackageManager.PERMISSION_GRANTED
      },
      adapter = adapter,
    ),
  )
}

private fun Context.bluetoothAdapter(): BluetoothAdapter? =
  (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
