package mx.grupofrio.thermalprinter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ThermalTicketLayoutTest {
  private val measurer = TextMeasurer { text, style ->
    TextMeasurement(
      width = text.length * style.sizePx * 0.5f,
      top = -style.sizePx.toFloat(),
      bottom = (style.lineHeightPx - style.sizePx).toFloat(),
    )
  }
  private val subject = ThermalTicketLayout(measurer)

  @Test
  fun `layout constants match the 384 dot printer contract`() {
    assertEquals(384, ThermalTicketLayout.WIDTH_PX)
    assertEquals(6_000, ThermalTicketLayout.MAX_HEIGHT_PX)
    assertEquals(8, ThermalTicketLayout.INSET_PX)
    assertEquals(256, ThermalTicketLayout.MAX_LOGO_PX)
    assertEquals(32, ThermalTicketLayout.BODY_SIZE_PX)
    assertEquals(40, ThermalTicketLayout.BODY_LINE_HEIGHT_PX)
    assertEquals(26, ThermalTicketLayout.SMALL_SIZE_PX)
    assertEquals(34, ThermalTicketLayout.SMALL_LINE_HEIGHT_PX)
    assertEquals(44, ThermalTicketLayout.TOTAL_SIZE_PX)
    assertEquals(54, ThermalTicketLayout.TOTAL_LINE_HEIGHT_PX)
    assertEquals(24, ThermalTicketLayout.MIN_AMOUNT_SIZE_PX)
  }

  @Test
  fun `layout has exact width full width dividers and inset text`() {
    val layout = subject.layout(ticket())

    assertEquals(384, layout.width)
    assertTrue(layout.commands.any { it is DrawCommand.Divider })
    assertTrue(
      layout.commands.filterIsInstance<DrawCommand.Text>()
        .filter { it.style.alignment == TextAlignment.LEFT }
        .all { it.x >= 8f },
    )
    assertTrue(
      layout.commands.filterIsInstance<DrawCommand.Text>()
        .filter { it.style.alignment == TextAlignment.RIGHT }
        .all { it.x == 376f },
    )
    // A divider carries only its row: the renderer contract always draws that row from 0 through 383.
    assertEquals(listOf("y"), DrawCommand.Divider::class.java.declaredFields.map { it.name })
  }

  @Test
  fun `official ticket labels the Odoo folio and omits local reference`() {
    val text = subject.layout(ticket(folio = "S00042", localReference = null))
      .commands.filterIsInstance<DrawCommand.Text>().map { it.text }

    assertTrue(text.windowed(2).contains(listOf("Folio Odoo:", "S00042")))
    assertFalse(text.contains("Folio:"))
    assertFalse(text.contains("Referencia local:"))
  }

  @Test
  fun `pending ticket prints Odoo status then normalized local reference`() {
    val text = subject.layout(
      ticket(
        folio = "Pendiente por sincronizar",
        localReference = " \u200Bmobile-op-1\r\n ",
      ),
    ).commands.filterIsInstance<DrawCommand.Text>().map { it.text }

    assertTrue(text.contains("Pendiente por"))
    assertTrue(text.contains("sincronizar"))
    assertTrue(text.indexOf("Folio Odoo:") < text.indexOf("Pendiente por"))
    assertTrue(text.indexOf("Referencia local:") < text.indexOf("mobile-op-1"))
  }

  @Test
  fun `wrap uses words first and characters only for a word too wide`() {
    val style = TextStyle(sizePx = 20, lineHeightPx = 26)

    val words = subject.wrapText("uno dos tres", style, maxWidth = 65f)
    val longWord = "extraordinariamente"
    val characters = subject.wrapText(longWord, style, maxWidth = 50f)

    assertEquals(listOf(""), subject.wrapText("", style, maxWidth = 50f))
    assertEquals(listOf("uno", "dos", "tres"), words)
    assertEquals(longWord, characters.joinToString(separator = ""))
    assertTrue(characters.all { measurer.measure(it, style).width <= 50f })
  }

  @Test
  fun `long unbroken supplementary word wraps only at code point boundaries`() {
    val word = "A" + iceCube.repeat(40)
    val quantity = "1 x $1.00"
    val layout = subject.layout(
      ticket(
        lines = listOf(TicketLine(1, word, quantity, "$1.00")),
      ),
    )
    val dividerIndices = layout.commands.withIndex()
      .filter { it.value is DrawCommand.Divider }
      .map { it.index }
    val productRegion = layout.commands.subList(dividerIndices[1] + 1, dividerIndices[2])
      .filterIsInstance<DrawCommand.Text>()
    val quantityIndex = productRegion.indexOfFirst { it.text == quantity }
    assertTrue("Quantity command must follow product-name chunks", quantityIndex > 0)
    val chunks = productRegion.subList(0, quantityIndex)
    val productStyle = TextStyle(
      sizePx = ThermalTicketLayout.BODY_SIZE_PX,
      lineHeightPx = ThermalTicketLayout.BODY_LINE_HEIGHT_PX,
      bold = true,
    )
    val availableWidth =
      (ThermalTicketLayout.WIDTH_PX - 2 * ThermalTicketLayout.INSET_PX).toFloat()

    assertTrue("Expected multiple product-name commands", chunks.size > 1)
    chunks.map { it.text }.forEach(::assertCanonicalDisplayText)
    assertEquals(word, chunks.joinToString(separator = "") { it.text })
    assertTrue(chunks.all { measurer.measure(it.text, productStyle).width <= availableWidth })
  }

  @Test
  fun `real vertical metrics expand rows beyond nominal line height without overlap`() {
    val tallSubject = ThermalTicketLayout(
      TextMeasurer { text, style ->
        TextMeasurement(
          width = text.length * style.sizePx * 0.5f,
          top = -30.2f,
          bottom = 7.2f,
        )
      },
    )

    val layout = tallSubject.layout(ticket(customerName = "Ana"))
    val commands = layout.commands.filterIsInstance<DrawCommand.Text>()
    val distinctRows = commands.map { it.top to it.bottomExclusive }.distinct().sortedBy { it.first }

    commands.forEach { command ->
      assertEquals(31f, command.baseline - command.top, 0f)
      assertTrue(command.bottomExclusive - command.top >= 39f)
      assertTrue(command.top >= 0f)
      assertTrue(command.bottomExclusive <= layout.height)
    }
    distinctRows.zipWithNext().forEach { (previous, next) ->
      assertTrue("Text row boxes overlap: $previous then $next", previous.second <= next.first)
    }
  }

  @Test
  fun `mixed style row uses common font extrema and one baseline`() {
    val mixedSubject = ThermalTicketLayout(
      TextMeasurer { text, style ->
        TextMeasurement(
          width = text.length * style.sizePx * 0.5f,
          top = if (style.bold) -35.1f else -21.1f,
          bottom = if (style.bold) 5.1f else 12.1f,
        )
      },
    )

    val layout = mixedSubject.layout(ticket(customerName = "Ana"))
    val label = layout.text("Cliente:")
    val value = layout.text("Ana")

    assertEquals(label.baseline, value.baseline)
    assertEquals(label.top, value.top)
    assertEquals(label.bottomExclusive, value.bottomExclusive)
    assertEquals(36f, label.baseline - label.top, 0f)
    assertEquals(13f, label.bottomExclusive - label.baseline, 0f)
  }

  @Test
  fun `supplementary code point wider than available width is invalid`() {
    val style = TextStyle(sizePx = 20, lineHeightPx = 26)

    val error = assertThrows(ThermalPrinterException::class.java) {
      subject.wrapText(iceCube, style, maxWidth = 15f)
    }

    assertEquals("invalid_ticket", error.code)
  }

  @Test
  fun `label and value share a row when they fit`() {
    val layout = subject.layout(ticket(customerName = "Ana"))
    val label = layout.text("Cliente:")
    val value = layout.text("Ana")

    assertEquals(label.baseline, value.baseline)
    assertTrue(value.x > label.x)
  }

  @Test
  fun `primary field label and value use separate readable styles`() {
    val layout = subject.layout(ticket(customerName = "Ana"))
    val label = layout.text("Cliente:")
    val value = layout.text("Ana")

    assertEquals(26, label.style.sizePx)
    assertEquals(34, label.style.lineHeightPx)
    assertTrue(label.style.bold)
    assertEquals(32, value.style.sizePx)
    assertEquals(40, value.style.lineHeightPx)
    assertFalse(value.style.bold)
  }

  @Test
  fun `value moves below and wraps when label and value do not fit`() {
    val customer = "Comercializadora de Refrigeración del Sureste Número Ciento Veintitrés"
    val layout = subject.layout(ticket(customerName = customer))
    val label = layout.text("Cliente:")
    val allText = layout.commands.filterIsInstance<DrawCommand.Text>()
    val labelIndex = allText.indexOf(label)
    val nextLabelIndex = allText.indexOfFirst { it.text == "Vendedor:" }
    val valueLines = allText.subList(labelIndex + 1, nextLabelIndex)

    assertTrue(valueLines.isNotEmpty())
    assertTrue(valueLines.first().baseline > label.baseline)
    assertEquals(customer, valueLines.joinToString(" ") { it.text })
  }

  @Test
  fun `long amount wraps right aligned and shrinks no lower than 24`() {
    val total = "$" + "9".repeat(43)
    val layout = subject.layout(ticket(total = total))
    val commands = layout.commands.filterIsInstance<DrawCommand.Text>()
      .filter { it.style.alignment == TextAlignment.RIGHT && it.text.all { char -> char == '$' || char.isDigit() } }

    assertTrue(commands.size > 1)
    assertEquals(total, commands.joinToString(separator = "") { it.text })
    assertEquals(376f, commands.first().x)
    assertEquals(24, commands.minOf { it.style.sizePx })
  }

  @Test
  fun `product amount uses readable total style and falls below quantity when pair does not fit`() {
    val quantity = "Cantidad 1234567890 x Precio $1234567890.00"
    val amount = "$100.00"
    val layout = subject.layout(
      ticket(lines = listOf(TicketLine(1, "Producto legible", quantity, amount))),
    )
    val dividerIndices = layout.commands.withIndex()
      .filter { it.value is DrawCommand.Divider }
      .map { it.index }
    val productCommands = layout.commands.subList(dividerIndices[1] + 1, dividerIndices[2])
      .filterIsInstance<DrawCommand.Text>()
    val quantityLines = productCommands.filter { it.text != quantity && it.text.contains("Cantidad") }
    val amountCommand = productCommands.single { it.text == amount }

    assertTrue(quantityLines.isNotEmpty())
    assertEquals(TextAlignment.RIGHT, amountCommand.style.alignment)
    assertEquals(44, amountCommand.style.sizePx)
    assertEquals(54, amountCommand.style.lineHeightPx)
    assertTrue(amountCommand.x == (ThermalTicketLayout.WIDTH_PX - ThermalTicketLayout.INSET_PX).toFloat())
    assertTrue(layout.commands.filterIsInstance<DrawCommand.Text>().all { it.bottomExclusive <= layout.height })
  }

  @Test
  fun `amount that cannot fit at minimum still preserves every character`() {
    val total = "$" + "9".repeat(47)
    val layout = subject.layout(ticket(total = total))
    val chunks = layout.commands.filterIsInstance<DrawCommand.Text>()
      .filter { it.style.alignment == TextAlignment.RIGHT && it.text.all { char -> char == '$' || char.isDigit() } }

    assertTrue(chunks.size > 1)
    assertEquals(total, chunks.joinToString(separator = "") { it.text })
  }

  @Test
  fun `logo scales proportionally without upscaling or clipping`() {
    val scaled = subject.layout(ticket(), LogoDimensions(width = 1_024, height = 512))
      .commands.filterIsInstance<DrawCommand.Logo>().single()
    val small = subject.layout(ticket(), LogoDimensions(width = 120, height = 60))
      .commands.filterIsInstance<DrawCommand.Logo>().single()

    assertEquals(256, scaled.width)
    assertEquals(128, scaled.height)
    assertEquals(120, small.width)
    assertEquals(60, small.height)
    assertTrue(scaled.top >= 0f)
    assertTrue(scaled.top + scaled.height <= subject.layout(ticket(), LogoDimensions(1_024, 512)).height)
  }

  @Test
  fun `credit promissory note increases height and remains inside layout`() {
    val cash = subject.layout(ticket())
    val note = "Pagaré: reconozco y pagaré incondicionalmente este importe en la fecha convenida."
    val credit = subject.layout(ticket(creditNote = note))
    val noteCommands = credit.commands.filterIsInstance<DrawCommand.Text>()
      .filter { it.text.contains("Pagaré") || it.text.contains("reconozco") || it.text.contains("importe") }

    assertTrue(credit.height > cash.height)
    assertTrue(noteCommands.isNotEmpty())
    assertTrue(noteCommands.maxOf { it.bottomExclusive } <= credit.height)
  }

  @Test
  fun `long Spanish customer seller payment and RFC are preserved`() {
    val customer = "Niñez y Refrigeración Muñoz de la Peña"
    val seller = "José Ángel Hernández Güemez"
    val payment = "Crédito con transferencia electrónica y recepción diferida"
    val rfc = "RFC: ÑÁÉÍÓÚ-123456-MX CON INFORMACIÓN ADICIONAL"
    val layout = subject.layout(
      ticket(
        customerName = customer,
        sellerName = seller,
        paymentLabel = payment,
        branding = branding(rfcLabel = rfc),
      ),
    )
    val renderedText = layout.commands.filterIsInstance<DrawCommand.Text>().joinToString(" ") { it.text }

    listOf(customer, seller, payment, rfc).forEach { original ->
      original.split(" ").forEach { word -> assertTrue("Missing $word", renderedText.contains(word)) }
    }
  }

  @Test
  fun `cash and credit layouts are stable and deterministic`() {
    val cash = ticket()
    val credit = ticket(creditNote = "Pagaré de crédito sin recortes")

    assertEquals(subject.layout(cash), subject.layout(cash))
    assertEquals(subject.layout(credit), subject.layout(credit))
    assertTrue(subject.layout(credit).height > subject.layout(cash).height)
  }

  @Test
  fun `exchange layout contains title customer grouped sections quantities and notes`() {
    val layout = subject.layout(exchangeRecord().toDomain())
    val textCommands = layout.commands.filterIsInstance<DrawCommand.Text>()
    val renderedText = textCommands.joinToString(" ") { it.text }

    listOf(
      "NOTA DE CAMBIO",
      "Cliente:",
      "Cliente intercambio",
      "ENTREGA",
      "MERMA",
      "3 x 20 kg",
      "1 x 10 kg",
      "Cambio autorizado por calidad",
    ).forEach { expected ->
      assertTrue("Missing exchange text: $expected", renderedText.contains(expected))
    }
  }

  @Test
  fun `exchange layout omits sale payment and totals rows`() {
    val renderedText = subject.layout(exchangeRecord().toDomain())
      .commands
      .filterIsInstance<DrawCommand.Text>()
      .joinToString(" ") { it.text }

    listOf("Pago:", "Subtotal:", "Kilogramos:", "Total:").forEach { forbidden ->
      assertFalse("Exchange layout must omit $forbidden", renderedText.contains(forbidden))
    }
  }

  @Test
  fun `content beyond 6000 pixels fails before a renderer could reserve a bitmap`() {
    val huge = ticket(
      lines = List(260) { index ->
        TicketLine(
          productId = index.toLong() + 1,
          productName = "Producto refrigerado número $index con descripción larga",
          quantityAndUnitPrice = "1 x $10.00",
          lineTotal = "$10.00",
        )
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) { subject.layout(huge) }

    assertEquals("ticket_too_large", error.code)
  }

  @Test
  fun `record validation returns coded errors instead of trusting mutable Expo input`() {
    val missing = ThermalTicketDocumentRecord()
    val wrongSchema = validRecord().apply { schemaVersion = 2 }
    val nonPositiveProduct = validRecord().apply { lines!!.single().productId = 0.0 }

    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { missing.toDomain() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { wrongSchema.toDomain() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { nonPositiveProduct.toDomain() }.code,
    )
  }

  @Test
  fun `record rejects blank ticket kind instead of defaulting it to sale`() {
    listOf("", "   ", "\n\t").forEach { ticketKind ->
      val record = validRecord().apply { setRecordField("ticketKind", ticketKind) }

      val error = assertThrows(ThermalPrinterException::class.java) { record.toDomain() }

      assertEquals("invalid_ticket", error.code)
    }
  }

  @Test
  fun `record rejects unknown ticket kind`() {
    val record = validRecord().apply { setRecordField("ticketKind", "refund") }

    val error = assertThrows(ThermalPrinterException::class.java) { record.toDomain() }

    assertEquals("invalid_ticket", error.code)
  }

  @Test
  fun `record rejects exchange lines without valid section labels`() {
    val missingLabel = exchangeRecord().apply {
      lines = mutableListOf(
        validLineRecord(1).apply { setRecordField("sectionLabel", "ENTREGA") },
        validLineRecord(2),
      )
    }
    val invalidLabel = exchangeRecord().apply {
      lines = mutableListOf(
        validLineRecord(1).apply { setRecordField("sectionLabel", "ENTREGA") },
        validLineRecord(2).apply { setRecordField("sectionLabel", "DEVOLUCIÓN") },
      )
    }

    listOf(missingLabel, invalidLabel).forEach { record ->
      val error = assertThrows(ThermalPrinterException::class.java) { record.toDomain() }
      assertEquals("invalid_ticket", error.code)
    }
  }

  @Test
  fun `record rejects raw display text before whitespace normalization can allocate its full size`() {
    val record = validRecord().apply {
      customerName = " ".repeat(100_000) + "Ana"
    }

    val error = assertThrows(ThermalPrinterException::class.java) { record.toDomain() }

    assertEquals("invalid_ticket", error.code)
  }

  @Test
  fun `record validates line count before converting mutable line records`() {
    val empty = validRecord().apply { lines = mutableListOf() }
    val tooMany = validRecord().apply {
      lines = MutableList(501) { validLineRecord(it + 1) }
    }

    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { empty.toDomain() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { tooMany.toDomain() }.code,
    )
  }

  @Test
  fun `record aggregate budget is enforced across lines before domain copies`() {
    val record = validRecord().apply {
      lines = MutableList(5) { index ->
        validLineRecord(index + 1).apply { productName = "P".repeat(8_192) }
      }
    }

    val error = assertThrows(ThermalPrinterException::class.java) { record.toDomain() }

    assertEquals("invalid_ticket", error.code)
  }

  @Test
  fun `direct domain validation rejects empty excessive and non-positive product lines`() {
    val cases = listOf(
      ticket(lines = emptyList()),
      ticket(lines = List(501) { index -> TicketLine(index.toLong() + 1, "P", "Q", "T") }),
      ticket(lines = listOf(TicketLine(0, "P", "Q", "T"))),
      ticket(lines = listOf(TicketLine(-1, "P", "Q", "T"))),
      ticket(customerName = " ".repeat(100_000) + "Ana"),
    )

    cases.forEach { directDomain ->
      assertEquals(
        "invalid_ticket",
        assertThrows(ThermalPrinterException::class.java) { subject.layout(directDomain) }.code,
      )
    }
  }

  @Test
  fun `aggregate display budget accepts exact UTF-16 boundary and rejects one unit over`() {
    val exactBoundary = aggregateBoundaryTicket(quantityLength = 8_180)
    val oneUnitOver = aggregateBoundaryTicket(quantityLength = 8_181)
    val oneOptionalUnitOver = exactBoundary.copy(localReference = "R")

    assertEquals(32_768, exactBoundary.normalizedForLayout().aggregateDisplayLength())
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { oneUnitOver.normalizedForLayout() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) {
        oneOptionalUnitOver.normalizedForLayout()
      }.code,
    )
  }

  @Test
  fun `record aggregate display budget includes optional local reference`() {
    val exactBoundary = aggregateBoundaryRecord()
    val oneOptionalUnitOver = aggregateBoundaryRecord().apply { localReference = "R" }

    assertEquals(32_768, exactBoundary.toDomain().aggregateDisplayLength())
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { oneOptionalUnitOver.toDomain() }.code,
    )
  }

  @Test
  fun `aggregate display budget spans multiple lines and excludes opaque logo base64`() {
    val base = aggregateBoundaryTicket(quantityLength = 8_180)
    val withinBudget = base.copy(
      branding = base.branding.copy(logoPngBase64 = "A".repeat(100_000)),
    )
    val overSeveralLines = ticket(
      lines = List(5) { index ->
        TicketLine(index.toLong() + 1, "P".repeat(8_192), "Q", "T")
      },
    )

    assertEquals(32_768, withinBudget.normalizedForLayout().aggregateDisplayLength())
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { overSeveralLines.normalizedForLayout() }.code,
    )
  }

  @Test
  fun `record conversion snapshots nested mutable lists into immutable domain values`() {
    val record = validRecord()
    val domain = record.toDomain()
    record.lines!!.clear()
    record.branding!!.legalName = "Mutated"

    assertEquals(1, domain.lines.size)
    assertFalse(domain.branding.legalName.contains("Mutated"))
    assertThrows(UnsupportedOperationException::class.java) {
      @Suppress("UNCHECKED_CAST")
      (domain.lines as MutableList<TicketLine>).clear()
    }
  }

  @Test
  fun `record conversion canonicalizes every display string but leaves base64 opaque`() {
    val opaqueLogo = "iVBORw0KGgo=\u0000\r\n\u200B\u2028\u202E$LANGUAGE_TAG"
    val record = validRecord().apply {
      branding!!.apply {
        logoPngBase64 = opaqueLogo
        legalName = "  Razón\r\n\u200B Social\t "
        rfcLabel = " RFC:\t\u202EAAA010101AAA "
        title = " NOTA\n$LANGUAGE_TAG DE\rVENTA "
        footer = " Gracias\t\u2028 por\u2029 su compra "
      }
      folio = " VENTA-\r\n42 "
      formattedDate = " 21/07/2026\t10:30 "
      customerName = " Ana\n\u200B María\u2003\tMuñoz $iceCube "
      sellerName = " José\r\u202EÁngel "
      paymentLabel = " Crédito\u0000\t diferido "
      lines!!.single().apply {
        productName = " Hielo\r\n$LANGUAGE_TAG premium\tazul $iceCube "
        quantityAndUnitPrice = " 2\t x\n $50.00 "
        lineTotal = " $100.00\r\n MXN "
      }
      subtotal = " $100.00\t MXN "
      totalKg = " 2\n kg "
      total = " $100.00\r MXN "
      creditNote = " Pagaré:\r\n\u202E pago$LANGUAGE_TAG incondicional "
    }

    val domain = record.toDomain()

    assertEquals(opaqueLogo, domain.branding.logoPngBase64)
    assertEquals("Razón Social", domain.branding.legalName)
    assertEquals("RFC: AAA010101AAA", domain.branding.rfcLabel)
    assertEquals("NOTA DE VENTA", domain.branding.title)
    assertEquals("Gracias por su compra", domain.branding.footer)
    assertEquals("VENTA- 42", domain.folio)
    assertEquals("21/07/2026 10:30", domain.formattedDate)
    assertEquals("Ana María Muñoz $iceCube", domain.customerName)
    assertEquals("José Ángel", domain.sellerName)
    assertEquals("Crédito diferido", domain.paymentLabel)
    assertEquals("Hielo premium azul $iceCube", domain.lines.single().productName)
    assertEquals("2 x $50.00", domain.lines.single().quantityAndUnitPrice)
    assertEquals("$100.00 MXN", domain.lines.single().lineTotal)
    assertEquals("$100.00 MXN", domain.subtotal)
    assertEquals("2 kg", domain.totalKg)
    assertEquals("$100.00 MXN", domain.total)
    assertEquals("Pagaré: pago incondicional", domain.creditNote)
    domain.displayValues().forEach(::assertCanonicalDisplayText)
  }

  @Test
  fun `required display text is validated after normalization and optional blanks disappear`() {
    val isolatedSurrogate = validRecord().apply { customerName = "Ana\uD83EBeto" }

    listOf(" \r\n\t ", " \u200B\u202E$LANGUAGE_TAG ").forEach { separatorsOnly ->
      val requiredBlank = validRecord().apply { customerName = separatorsOnly }
      val optionalBlank = validRecord().apply { creditNote = separatorsOnly }

      assertEquals(
        "invalid_ticket",
        assertThrows(ThermalPrinterException::class.java) { requiredBlank.toDomain() }.code,
      )
      assertEquals(null, optionalBlank.toDomain().creditNote)
    }
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { isolatedSurrogate.toDomain() }.code,
    )
  }

  @Test
  fun `separator-only local reference disappears at record and direct-domain boundaries`() {
    listOf(" \r\n\t ", " \u200B\u202E$LANGUAGE_TAG ").forEach { separatorsOnly ->
      val record = validRecord().apply { localReference = separatorsOnly }
      val directDomain = ticket(localReference = separatorsOnly)

      assertEquals(null, record.toDomain().localReference)
      assertEquals(null, directDomain.normalizedForLayout().localReference)
    }
  }

  @Test
  fun `overlong local reference is invalid at record and direct-domain boundaries`() {
    val overlong = "R".repeat(257)
    val record = validRecord().apply { localReference = overlong }
    val directDomain = ticket(localReference = overlong)

    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { record.toDomain() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) {
        directDomain.normalizedForLayout()
      }.code,
    )
  }

  @Test
  fun `isolated surrogate local reference is invalid at record and direct-domain boundaries`() {
    val unsafe = "mobile-\uD83E-op-1"
    val record = validRecord().apply { localReference = unsafe }
    val directDomain = ticket(localReference = unsafe)

    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) { record.toDomain() }.code,
    )
    assertEquals(
      "invalid_ticket",
      assertThrows(ThermalPrinterException::class.java) {
        directDomain.normalizedForLayout()
      }.code,
    )
  }

  @Test
  fun `logo version rejects unsafe whitespace controls and BMP or supplementary format code points`() {
    val unsafeIdentifiers = listOf(
      "\u0000",
      "\t",
      "\u200B",
      "\u2028",
      "\u2029",
      "\u202E",
      LANGUAGE_TAG,
    )

    unsafeIdentifiers.forEach { unsafe ->
      val record = validRecord().apply { branding!!.logoVersion = "version${unsafe}1" }
      val directDomain = ticket().copy(
        branding = branding().copy(logoVersion = "version${unsafe}1"),
      )

      assertEquals(
        "invalid_ticket",
        assertThrows(ThermalPrinterException::class.java) { record.toDomain() }.code,
      )
      assertEquals(
        "invalid_ticket",
        assertThrows(ThermalPrinterException::class.java) { subject.layout(directDomain) }.code,
      )
    }
  }

  @Test
  fun `layout defensively canonicalizes direct domain values before creating text commands`() {
    val directDomain = ticket(
      customerName = " Ana\r\n\u200B María\t Muñoz $iceCube ",
      sellerName = " José\r\u202E Ángel ",
      paymentLabel = " Crédito\u0000\n diferido ",
      total = " $100.00\t MXN ",
      creditNote = " Pagaré:\r\n pago$LANGUAGE_TAG incondicional ",
      branding = branding().copy(
        legalName = " Soluciones\r\n\u200B Frías ",
        footer = " Gracias\t\u2028 por\u2029 su compra ",
      ),
      lines = listOf(
        TicketLine(
          1,
          " Hielo\r\n\u202E premium\tazul $iceCube ",
          " 2\t x\n $50.00 ",
          " $100.00\r MXN ",
        ),
      ),
    ).copy(
      folio = " VENTA-\r\n42 ",
      formattedDate = " 21/07/2026\t10:30 ",
      subtotal = " $100.00\t MXN ",
      totalKg = " 2\n kg ",
    )

    val textCommands = subject.layout(directDomain).commands.filterIsInstance<DrawCommand.Text>()
    val renderedText = textCommands.joinToString(" ") { it.text }

    textCommands.map { it.text }.forEach(::assertCanonicalDisplayText)
    listOf(
      "Soluciones Frías",
      "VENTA- 42",
      "21/07/2026 10:30",
      "Ana María Muñoz $iceCube",
      "José Ángel",
      "Crédito diferido",
      "Hielo premium azul $iceCube",
      "2 x $50.00",
      "$100.00 MXN",
      "2 kg",
      "Pagaré: pago incondicional",
      "Gracias por su compra",
    ).forEach { expected ->
      assertTrue("Missing canonical text: $expected", renderedText.contains(expected))
    }
  }

  private fun TicketLayout.text(value: String): DrawCommand.Text =
    commands.filterIsInstance<DrawCommand.Text>().single { it.text == value }

  private fun ThermalTicket.displayValues(): List<String> = listOf(
    branding.legalName,
    branding.rfcLabel,
    branding.title,
    branding.footer,
    folio,
    formattedDate,
    customerName,
    sellerName,
    paymentLabel,
    subtotal,
    totalKg,
    total,
  ) + listOfNotNull(localReference, creditNote) + lines.flatMap { line ->
    listOf(line.productName, line.quantityAndUnitPrice, line.lineTotal)
  }

  private fun ThermalTicket.aggregateDisplayLength(): Int = displayValues().sumOf(String::length)

  private fun aggregateBoundaryTicket(quantityLength: Int): ThermalTicket = ThermalTicket(
    schemaVersion = 1,
    branding = TicketBranding(
      logoPngBase64 = "iVBORw0KGgo=",
      logoVersion = "v1",
      legalName = "L",
      rfcLabel = "R",
      title = "T",
      footer = "F".repeat(16_384),
    ),
    folio = "F",
    formattedDate = "D",
    customerName = "C",
    sellerName = "S",
    paymentLabel = "P",
    lines = listOf(
      TicketLine(1, "N".repeat(8_192), "Q".repeat(quantityLength), "A"),
    ),
    subtotal = "S",
    totalKg = "K",
    total = "T",
    creditNote = null,
    localReference = null,
  )

  private fun aggregateBoundaryRecord(): ThermalTicketDocumentRecord = validRecord().apply {
    branding!!.apply {
      legalName = "L"
      rfcLabel = "R"
      title = "T"
      footer = "F".repeat(16_384)
    }
    folio = "F"
    formattedDate = "D"
    customerName = "C"
    sellerName = "S"
    paymentLabel = "P"
    lines!!.single().apply {
      productName = "N".repeat(8_192)
      quantityAndUnitPrice = "Q".repeat(8_180)
      lineTotal = "A"
    }
    subtotal = "S"
    totalKg = "K"
    total = "T"
    localReference = null
  }

  private fun assertCanonicalDisplayText(value: String) {
    assertFalse("Display text must be trimmed: '$value'", value.startsWith(' ') || value.endsWith(' '))
    var index = 0
    var previousWasSpace = false
    while (index < value.length) {
      val codePoint = Character.codePointAt(value, index)
      val type = Character.getType(codePoint)
      val unsafe = codePoint != ASCII_SPACE && (
        Character.isWhitespace(codePoint) ||
          Character.isSpaceChar(codePoint) ||
          type == Character.CONTROL.toInt() ||
          type == Character.FORMAT.toInt() ||
          type == Character.LINE_SEPARATOR.toInt() ||
          type == Character.PARAGRAPH_SEPARATOR.toInt() ||
          type == Character.SURROGATE.toInt()
        )
      assertFalse("Unsafe U+${codePoint.toString(16)} in '$value'", unsafe)
      assertFalse("Repeated ASCII spaces in '$value'", codePoint == ASCII_SPACE && previousWasSpace)
      previousWasSpace = codePoint == ASCII_SPACE
      index += Character.charCount(codePoint)
    }
  }

  private fun validRecord(): ThermalTicketDocumentRecord = ThermalTicketDocumentRecord().apply {
    schemaVersion = 1
    branding = ThermalTicketBrandingRecord().apply {
      logoPngBase64 = "iVBORw0KGgo="
      logoVersion = "v1"
      legalName = "Razón Social"
      rfcLabel = "RFC: AAA010101AAA"
      title = "NOTA DE VENTA"
      footer = "Gracias"
    }
    folio = "42"
    formattedDate = "21/07/2026"
    customerName = "Ana"
    sellerName = "José"
    paymentLabel = "Efectivo"
    lines = mutableListOf(
      ThermalTicketLineRecord().apply {
        productId = 1.0
        productName = "Hielo"
        quantityAndUnitPrice = "1 x $10.00"
        lineTotal = "$10.00"
      },
    )
    subtotal = "$10.00"
    totalKg = "1 kg"
    total = "$10.00"
  }

  private fun validLineRecord(id: Int): ThermalTicketLineRecord = ThermalTicketLineRecord().apply {
    productId = id.toDouble()
    productName = "Hielo"
    quantityAndUnitPrice = "1 x $10.00"
    lineTotal = "$10.00"
  }

  private fun exchangeRecord(): ThermalTicketDocumentRecord = validRecord().apply {
    branding!!.title = "NOTA DE CAMBIO"
    customerName = "Cliente intercambio"
    paymentLabel = "N/A"
    subtotal = "$0.00"
    totalKg = "0 kg"
    total = "$0.00"
    lines = mutableListOf(
      validLineRecord(1).apply {
        productName = "Hielo entregado"
        quantityAndUnitPrice = "3 x 20 kg"
        lineTotal = "60 kg"
        setRecordField("sectionLabel", "ENTREGA")
      },
      validLineRecord(2).apply {
        productName = "Hielo merma"
        quantityAndUnitPrice = "1 x 10 kg"
        lineTotal = "10 kg"
        setRecordField("sectionLabel", "MERMA")
      },
    )
    setRecordField("ticketKind", "exchange")
    setRecordField(
      "exchangeNotes",
      "Cambio autorizado por calidad con revisión de almacén.",
    )
  }

  private fun Any.setRecordField(name: String, value: Any?) {
    val field = javaClass.getDeclaredField(name)
    field.isAccessible = true
    field.set(this, value)
  }

  private fun ticket(
    folio: String = "VENTA-42",
    localReference: String? = null,
    customerName: String = "Cliente Uno",
    sellerName: String = "Vendedor Uno",
    paymentLabel: String = "Efectivo",
    total: String = "$100.00",
    creditNote: String? = null,
    branding: TicketBranding = branding(),
    lines: List<TicketLine> = listOf(
      TicketLine(1, "Producto de prueba", "2 x $50.00", "$100.00"),
    ),
  ): ThermalTicket = ThermalTicket(
    schemaVersion = 1,
    branding = branding,
    folio = folio,
    formattedDate = "21/07/2026 10:30",
    customerName = customerName,
    sellerName = sellerName,
    paymentLabel = paymentLabel,
    lines = lines,
    subtotal = "$100.00",
    totalKg = "2 kg",
    total = total,
    creditNote = creditNote,
    localReference = localReference,
  )

  private fun branding(rfcLabel: String = "RFC: AAA010101AAA") = TicketBranding(
    logoPngBase64 = "iVBORw0KGgo=",
    logoVersion = "v1",
    legalName = "SOLUCIONES EN REFRIGERACIÓN",
    rfcLabel = rfcLabel,
    title = "NOTA DE VENTA",
    footer = "Gracias por su compra",
  )

  private companion object {
    const val ASCII_SPACE = 0x20
    val LANGUAGE_TAG: String = String(Character.toChars(0xE0001))
    val iceCube: String = String(Character.toChars(0x1F9CA))
  }
}
