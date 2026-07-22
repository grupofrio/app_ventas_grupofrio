package mx.grupofrio.thermalprinter

data class MonochromeRaster(
  val width: Int,
  val height: Int,
  val bytes: ByteArray,
)

data class RasterBand(
  val rowOffset: Int,
  val rowCount: Int,
  val command: ByteArray,
)

class EscPosRasterEncoder(private val bandRows: Int = DEFAULT_BAND_ROWS) {
  init {
    require(bandRows > 0) { "bandRows must be positive" }
    require(bandRows <= MAX_UNSIGNED_SHORT) { "bandRows must fit the GS v 0 height field" }
  }

  fun initialize(): ByteArray = byteArrayOf(ESC, AT)

  fun bands(raster: MonochromeRaster): Sequence<RasterBand> = sequence {
    val bytesPerRow = validateRaster(raster)
    val largestBandRows = minOf(bandRows, raster.height)
    val largestPayloadSize = bytesPerRow.toLong() * largestBandRows.toLong()
    require(largestPayloadSize < MAX_BAND_PAYLOAD_BYTES) {
      "Raster band payload must be smaller than $MAX_BAND_PAYLOAD_BYTES bytes"
    }

    var rowOffset = 0
    while (rowOffset < raster.height) {
      val rowCount = minOf(bandRows, raster.height - rowOffset)
      val payloadSize = (bytesPerRow.toLong() * rowCount.toLong()).toInt()
      val sourceOffset = (bytesPerRow.toLong() * rowOffset.toLong()).toInt()
      val command = ByteArray(HEADER_SIZE + payloadSize)

      command[0] = GS
      command[1] = LOWERCASE_V
      command[2] = ASCII_ZERO
      command[3] = RASTER_MODE
      writeUnsignedShortLittleEndian(command, WIDTH_OFFSET, bytesPerRow)
      writeUnsignedShortLittleEndian(command, HEIGHT_OFFSET, rowCount)
      raster.bytes.copyInto(
        destination = command,
        destinationOffset = HEADER_SIZE,
        startIndex = sourceOffset,
        endIndex = sourceOffset + payloadSize,
      )

      yield(RasterBand(rowOffset = rowOffset, rowCount = rowCount, command = command))
      rowOffset += rowCount
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
    require(raster.bytes.size.toLong() == expectedLength) {
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
