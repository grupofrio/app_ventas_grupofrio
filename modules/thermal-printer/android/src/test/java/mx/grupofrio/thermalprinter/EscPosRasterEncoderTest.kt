package mx.grupofrio.thermalprinter

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPosRasterEncoderTest {
  @Test
  fun `384 pixels produce 48 raster bytes per row`() {
    val raster = MonochromeRaster(384, 1, ByteArray(48))

    val band = EscPosRasterEncoder().bands(raster).single()

    assertEquals(48, band.command.size - HEADER_SIZE)
  }

  @Test
  fun `pixel bytes preserve MSB first bits and zero white bits`() {
    val pixels = byteArrayOf(0b1000_0001.toByte(), 0b0100_0000)
    val raster = MonochromeRaster(16, 1, pixels)

    val payload = EscPosRasterEncoder().bands(raster).single().command.copyOfRange(HEADER_SIZE, HEADER_SIZE + pixels.size)

    assertArrayEquals(pixels, payload)
    assertEquals(0, payload[0].toInt() and 0b0111_1110)
    assertEquals(0, payload[1].toInt() and 0b1011_1111)
  }

  @Test
  fun `default bands contain at most 512 rows`() {
    val raster = MonochromeRaster(8, 1_025, ByteArray(1_025))

    val bands = EscPosRasterEncoder().bands(raster).toList()

    assertEquals(listOf(512, 512, 1), bands.map { it.rowCount })
  }

  @Test
  fun `full 384 by 512 band payload is 24576 bytes below 40 KiB`() {
    val payloadSize = 48 * 512
    val raster = MonochromeRaster(384, 512, ByteArray(payloadSize))

    val band = EscPosRasterEncoder().bands(raster).single()

    assertEquals(24_576, band.command.size - HEADER_SIZE)
    assertTrue(band.command.size - HEADER_SIZE < MAX_BAND_PAYLOAD_BYTES)
  }

  @Test
  fun `GS v 0 header encodes width bytes and height rows little endian`() {
    val raster = MonochromeRaster(384, 2, ByteArray(48 * 2))

    val header = EscPosRasterEncoder().bands(raster).single().command.copyOfRange(0, HEADER_SIZE)

    assertArrayEquals(
      byteArrayOf(0x1D, 0x76, 0x30, 0x00, 0x30, 0x00, 0x02, 0x00),
      header,
    )
  }

  @Test
  fun `initialize emits ESC at`() {
    assertArrayEquals(byteArrayOf(0x1B, 0x40), EscPosRasterEncoder().initialize())
  }

  @Test
  fun `feed defaults to four lines`() {
    assertArrayEquals(byteArrayOf(0x1B, 0x64, 0x04), EscPosRasterEncoder().feed())
  }

  @Test
  fun `feed encodes configurable byte safe line counts`() {
    assertArrayEquals(byteArrayOf(0x1B, 0x64, 0x00), EscPosRasterEncoder().feed(0))
    assertArrayEquals(byteArrayOf(0x1B, 0x64, 0x7F), EscPosRasterEncoder().feed(127))
    assertArrayEquals(byteArrayOf(0x1B, 0x64, 0xFF.toByte()), EscPosRasterEncoder().feed(255))
  }

  @Test
  fun `multiple bands preserve row offsets order and final real height without padding`() {
    val rows = byteArrayOf(0x01, 0x02, 0x04, 0x08, 0x10)
    val raster = MonochromeRaster(8, rows.size, rows)

    val bands = EscPosRasterEncoder(bandRows = 2).bands(raster).toList()

    assertEquals(listOf(0, 2, 4), bands.map { it.rowOffset })
    assertEquals(listOf(2, 2, 1), bands.map { it.rowCount })
    assertArrayEquals(byteArrayOf(0x01, 0x02), bands[0].payload())
    assertArrayEquals(byteArrayOf(0x04, 0x08), bands[1].payload())
    assertArrayEquals(byteArrayOf(0x10), bands[2].payload())
    assertArrayEquals(byteArrayOf(0x01, 0x00), bands[2].command.copyOfRange(6, 8))
    assertEquals(HEADER_SIZE + 1, bands[2].command.size)
  }

  @Test
  fun `sequence materializes the next band only when requested`() {
    val bytes = byteArrayOf(0x01, 0x02)
    val iterator = EscPosRasterEncoder(bandRows = 1)
      .bands(MonochromeRaster(8, 2, bytes))
      .iterator()

    assertArrayEquals(byteArrayOf(0x01), iterator.next().payload())
    bytes[1] = 0x04

    assertArrayEquals(byteArrayOf(0x04), iterator.next().payload())
    assertFalse(iterator.hasNext())
  }

  @Test
  fun `ticket total may exceed 64 KiB when every band stays below 40 KiB`() {
    val height = 1_366
    val raster = MonochromeRaster(384, height, ByteArray(48 * height))

    val bands = EscPosRasterEncoder().bands(raster).toList()

    assertEquals(listOf(512, 512, 342), bands.map { it.rowCount })
    assertTrue(bands.sumOf { it.command.size.toLong() } > 64L * 1_024L)
    assertTrue(bands.all { it.command.size - HEADER_SIZE < MAX_BAND_PAYLOAD_BYTES })
  }

  @Test
  fun `rejects width not divisible by eight`() {
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(9, 1, ByteArray(1))).toList()
    }
  }

  @Test
  fun `rejects non positive raster dimensions`() {
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(0, 1, ByteArray(0))).toList()
    }
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(8, 0, ByteArray(0))).toList()
    }
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(-8, 1, ByteArray(0))).toList()
    }
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(8, -1, ByteArray(0))).toList()
    }
  }

  @Test
  fun `rejects raster byte length mismatch`() {
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(MonochromeRaster(16, 2, ByteArray(3))).toList()
    }
  }

  @Test
  fun `rejects non positive band row count`() {
    assertThrows(IllegalArgumentException::class.java) { EscPosRasterEncoder(bandRows = 0) }
    assertThrows(IllegalArgumentException::class.java) { EscPosRasterEncoder(bandRows = -1) }
  }

  @Test
  fun `rejects dimensions that cannot fit GS v 0 fields`() {
    val tooWideInBytes = 65_536
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(
        MonochromeRaster(tooWideInBytes * 8, 1, ByteArray(tooWideInBytes)),
      ).toList()
    }
    assertThrows(IllegalArgumentException::class.java) { EscPosRasterEncoder(bandRows = 65_536) }
  }

  @Test
  fun `rejects feed outside unsigned byte range`() {
    assertThrows(IllegalArgumentException::class.java) { EscPosRasterEncoder().feed(-1) }
    assertThrows(IllegalArgumentException::class.java) { EscPosRasterEncoder().feed(256) }
  }

  @Test
  fun `rejects an individual band payload at the 40 KiB limit`() {
    val width = 640
    val payloadAtLimit = 80 * 512
    val raster = MonochromeRaster(width, 512, ByteArray(payloadAtLimit))

    assertEquals(MAX_BAND_PAYLOAD_BYTES, payloadAtLimit)
    assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(raster).toList()
    }
  }

  @Test
  fun `rejects expected raster lengths that overflow an Int array`() {
    val maxWidthInBytes = 65_535
    val overflowingHeight = 32_769

    val error = assertThrows(IllegalArgumentException::class.java) {
      EscPosRasterEncoder().bands(
        MonochromeRaster(maxWidthInBytes * 8, overflowingHeight, ByteArray(0)),
      ).toList()
    }

    assertTrue(error.message.orEmpty().contains("too large", ignoreCase = true))
  }

  private fun RasterBand.payload(): ByteArray = command.copyOfRange(HEADER_SIZE, command.size)

  private companion object {
    const val HEADER_SIZE = 8
    const val MAX_BAND_PAYLOAD_BYTES = 40 * 1_024
  }
}
