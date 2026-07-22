package mx.grupofrio.thermalprinter

/**
 * Immutable snapshot of packed monochrome pixels.
 *
 * Construction copies the complete input once. Reading [bytes] returns another copy, while the
 * encoder uses bounded internal copies so it never duplicates the complete raster per band.
 */
class MonochromeRaster(
  val width: Int,
  val height: Int,
  bytes: ByteArray,
) {
  private val byteSnapshot = bytes.copyOf()

  val bytes: ByteArray
    get() = byteSnapshot.copyOf()

  internal val byteCount: Int
    get() = byteSnapshot.size

  internal fun copyBytesInto(
    destination: ByteArray,
    destinationOffset: Int,
    startIndex: Int,
    endIndex: Int,
  ) {
    byteSnapshot.copyInto(
      destination = destination,
      destinationOffset = destinationOffset,
      startIndex = startIndex,
      endIndex = endIndex,
    )
  }
}

/**
 * Immutable raster command for one contiguous row range.
 *
 * The public constructor snapshots [command], and every read returns a copy. The encoder can take
 * ownership only of a newly allocated, unexposed command to avoid an otherwise redundant copy.
 */
class RasterBand private constructor(
  val rowOffset: Int,
  val rowCount: Int,
  command: ByteArray,
  copyCommand: Boolean,
) {
  private val commandSnapshot = if (copyCommand) command.copyOf() else command

  constructor(rowOffset: Int, rowCount: Int, command: ByteArray) :
    this(rowOffset, rowCount, command, copyCommand = true)

  val command: ByteArray
    get() = commandSnapshot.copyOf()

  companion object {
    internal fun fromOwnedCommand(rowOffset: Int, rowCount: Int, command: ByteArray): RasterBand =
      RasterBand(rowOffset, rowCount, command, copyCommand = false)
  }
}

class EscPosRasterEncoder(private val bandRows: Int = DEFAULT_BAND_ROWS) {
  init {
    require(bandRows > 0) { "bandRows must be positive" }
    require(bandRows <= MAX_UNSIGNED_SHORT) { "bandRows must fit the GS v 0 height field" }
  }

  fun initialize(): ByteArray = byteArrayOf(ESC, AT)

  fun bands(raster: MonochromeRaster): Sequence<RasterBand> {
    val bytesPerRow = validateRaster(raster)
    val height = raster.height
    val largestBandRows = minOf(bandRows, height)
    val largestPayloadSize = bytesPerRow.toLong() * largestBandRows.toLong()
    require(largestPayloadSize < MAX_BAND_PAYLOAD_BYTES) {
      "Raster band payload must be smaller than $MAX_BAND_PAYLOAD_BYTES bytes"
    }

    return sequence {
      var rowOffset = 0
      while (rowOffset < height) {
        val rowCount = minOf(bandRows, height - rowOffset)
        val payloadSize = (bytesPerRow.toLong() * rowCount.toLong()).toInt()
        val sourceOffset = (bytesPerRow.toLong() * rowOffset.toLong()).toInt()
        val command = ByteArray(HEADER_SIZE + payloadSize)

        command[0] = GS
        command[1] = LOWERCASE_V
        command[2] = ASCII_ZERO
        command[3] = RASTER_MODE
        writeUnsignedShortLittleEndian(command, WIDTH_OFFSET, bytesPerRow)
        writeUnsignedShortLittleEndian(command, HEIGHT_OFFSET, rowCount)
        raster.copyBytesInto(
          destination = command,
          destinationOffset = HEADER_SIZE,
          startIndex = sourceOffset,
          endIndex = sourceOffset + payloadSize,
        )

        yield(
          RasterBand.fromOwnedCommand(
            rowOffset = rowOffset,
            rowCount = rowCount,
            command = command,
          ),
        )
        rowOffset += rowCount
      }
    }
  }

  fun feed(lines: Int = DEFAULT_FEED_LINES): ByteArray {
    require(lines in 0..MAX_UNSIGNED_BYTE) { "Feed lines must fit an unsigned byte" }
    return byteArrayOf(ESC, LOWERCASE_D, lines.toByte())
  }

  private fun validateRaster(raster: MonochromeRaster): Int {
    require(raster.width > 0) { "Raster width must be positive" }
    require(raster.height > 0) { "Raster height must be positive" }
    require(raster.width % BITS_PER_BYTE == 0) { "Raster width must be divisible by 8" }

    val bytesPerRow = raster.width / BITS_PER_BYTE
    require(bytesPerRow <= MAX_UNSIGNED_SHORT) { "Raster width must fit the GS v 0 width field" }

    val expectedLength = bytesPerRow.toLong() * raster.height.toLong()
    require(expectedLength <= Int.MAX_VALUE.toLong()) { "Raster byte length is too large for a ByteArray" }
    require(raster.byteCount.toLong() == expectedLength) {
      "Raster byte length must equal bytesPerRow * height"
    }
    return bytesPerRow
  }

  private fun writeUnsignedShortLittleEndian(target: ByteArray, offset: Int, value: Int) {
    target[offset] = (value and MAX_UNSIGNED_BYTE).toByte()
    target[offset + 1] = (value ushr BITS_PER_BYTE).toByte()
  }

  private companion object {
    const val DEFAULT_BAND_ROWS = 512
    const val DEFAULT_FEED_LINES = 4
    const val MAX_BAND_PAYLOAD_BYTES = 40 * 1_024
    const val MAX_UNSIGNED_BYTE = 0xFF
    const val MAX_UNSIGNED_SHORT = 0xFFFF
    const val BITS_PER_BYTE = 8
    const val HEADER_SIZE = 8
    const val WIDTH_OFFSET = 4
    const val HEIGHT_OFFSET = 6

    const val ESC: Byte = 0x1B
    const val GS: Byte = 0x1D
    const val AT: Byte = 0x40
    const val LOWERCASE_D: Byte = 0x64
    const val LOWERCASE_V: Byte = 0x76
    const val ASCII_ZERO: Byte = 0x30
    const val RASTER_MODE: Byte = 0x00
  }
}
