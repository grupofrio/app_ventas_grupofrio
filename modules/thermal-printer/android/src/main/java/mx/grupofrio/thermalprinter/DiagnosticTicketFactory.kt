package mx.grupofrio.thermalprinter

/**
 * Builds the calibration document entirely from caller-supplied identity. The repeated test rows
 * deliberately produce more than 64 KiB at 48 bytes per row so the diagnostic exercises multiple
 * GS v 0 bands and the transport's pacing path.
 */
internal class DiagnosticTicketFactory {
  fun create(branding: TicketBranding): ThermalTicket = ThermalTicket(
    schemaVersion = 1,
    branding = branding,
    folio = "DIAGNOSTICO MP210 - 384 dots",
    formattedDate = "á é í ó ú ñ Ñ $",
    customerName = "Bordes verticales x=0 y x=383",
    sellerName = "Regla horizontal y patrón checker",
    paymentLabel = "Raster GS v 0 en franjas",
    lines = calibrationLines(),
    subtotal = "$ 12,345.67",
    totalKg = "384 dots / 48 bytes por fila",
    // A wide-glyph ruler forces the total amount down to the ticket's 16 px minimum while fitting.
    total = "界界界界界界界界界界界界界界界界界界界界界界",
    creditNote = "Verificar alineación de importes, logo, acentos, bordes y continuidad de franjas.",
  )

  /** Adds physical edge columns plus a full-width rule/checker without changing raster dimensions. */
  fun addCalibrationMarks(raster: MonochromeRaster): MonochromeRaster {
    if (raster.width != ThermalTicketLayout.WIDTH_PX || raster.height < 2) {
      invalidTicket("Diagnostic raster must be 384 dots wide and at least two rows tall")
    }
    val bytesPerRow = raster.width / BITS_PER_BYTE
    val bytes = raster.bytes
    if (bytes.size != bytesPerRow * raster.height) {
      invalidTicket("Diagnostic raster byte length is invalid")
    }

    for (y in 0 until raster.height) {
      val row = y * bytesPerRow
      bytes[row] = (bytes[row].toInt() or LEFT_EDGE_MASK).toByte()
      val last = row + bytesPerRow - 1
      bytes[last] = (bytes[last].toInt() or RIGHT_EDGE_MASK).toByte()
    }
    bytes.fill(FULL_RULE, 0, bytesPerRow)
    bytes.fill(CHECKER, bytesPerRow, bytesPerRow * 2)
    bytes[bytesPerRow] = (bytes[bytesPerRow].toInt() or LEFT_EDGE_MASK).toByte()
    bytes[bytesPerRow * 2 - 1] =
      (bytes[bytesPerRow * 2 - 1].toInt() or RIGHT_EDGE_MASK).toByte()
    return MonochromeRaster(raster.width, raster.height, bytes)
  }

  private fun calibrationLines(): List<TicketLine> {
    val lines = ArrayList<TicketLine>(CALIBRATION_LINE_COUNT)
    lines += TicketLine(
      productId = 1,
      productName = "BORDES x=0 | x=383 - línea vertical completa",
      quantityAndUnitPrice = "á é í ó ú ñ Ñ $",
      lineTotal = "$ 1.00",
    )
    lines += TicketLine(
      productId = 2,
      productName = "ANCHO 384 dots",
      quantityAndUnitPrice = "Estrategia raster GS v 0",
      lineTotal = "$ 384.00",
    )
    for (index in 3..CALIBRATION_LINE_COUNT) {
      lines += TicketLine(
        productId = index.toLong(),
        productName = "Continuidad de banda y checker ${index.toString().padStart(2, '0')}",
        quantityAndUnitPrice = "Importe alineado ${index.toString().padStart(2, '0')}",
        lineTotal = "$ ${index}.00",
      )
    }
    return lines
  }

  private companion object {
    const val CALIBRATION_LINE_COUNT = 34
    const val BITS_PER_BYTE = 8
    const val LEFT_EDGE_MASK = 0x80
    const val RIGHT_EDGE_MASK = 0x01
    const val FULL_RULE: Byte = 0xFF.toByte()
    const val CHECKER: Byte = 0xAA.toByte()
  }
}
