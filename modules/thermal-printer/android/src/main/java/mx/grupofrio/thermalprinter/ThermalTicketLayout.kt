package mx.grupofrio.thermalprinter

import java.util.Collections
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

fun interface TextMeasurer {
  fun width(text: String, style: TextStyle): Float
}

enum class TextAlignment {
  LEFT,
  CENTER,
  RIGHT,
}

data class TextStyle(
  val sizePx: Int,
  val lineHeightPx: Int,
  val bold: Boolean = false,
  val alignment: TextAlignment = TextAlignment.LEFT,
) {
  init {
    require(sizePx > 0) { "Text size must be positive" }
    require(lineHeightPx >= sizePx) { "Line height must contain the text size" }
  }
}

sealed interface DrawCommand {
  data class Text(
    val text: String,
    val x: Float,
    val baseline: Float,
    val style: TextStyle,
  ) : DrawCommand

  /** The renderer draws this row from x=0 through x=[ThermalTicketLayout.WIDTH_PX] - 1. */
  data class Divider(val y: Float) : DrawCommand

  /** Logos are horizontally centered by the renderer. */
  data class Logo(val top: Float, val width: Int, val height: Int) : DrawCommand
}

data class LogoDimensions(val width: Int, val height: Int)

data class TicketLayout internal constructor(
  val width: Int,
  val height: Int,
  val commands: List<DrawCommand>,
)

class ThermalTicketLayout(private val textMeasurer: TextMeasurer) {
  fun layout(ticket: ThermalTicket, logoDimensions: LogoDimensions? = null): TicketLayout {
    if (ticket.schemaVersion != 1) invalidTicket("Unsupported schemaVersion")
    val safeTicket = ticket.normalizedForLayout()
    val builder = LayoutBuilder()

    logoDimensions?.let(builder::addLogo)
    builder.addWrapped(safeTicket.branding.legalName, BODY_BOLD_CENTER)
    builder.addWrapped(safeTicket.branding.rfcLabel, SMALL_CENTER)
    builder.addWrapped(safeTicket.branding.title, TOTAL_BOLD_CENTER)
    builder.addDivider()

    builder.addLabelValue("Folio:", safeTicket.folio, BODY_STYLE)
    builder.addLabelValue("Fecha:", safeTicket.formattedDate, BODY_STYLE)
    builder.addLabelValue("Cliente:", safeTicket.customerName, BODY_STYLE)
    builder.addLabelValue("Vendedor:", safeTicket.sellerName, BODY_STYLE)
    builder.addLabelValue("Pago:", safeTicket.paymentLabel, BODY_STYLE)
    builder.addDivider()

    safeTicket.lines.forEach { line ->
      builder.addWrapped(line.productName, BODY_BOLD)
      builder.addAmountRow(line.quantityAndUnitPrice, line.lineTotal, SMALL_STYLE)
      builder.addGap(PRODUCT_GAP_PX)
    }

    builder.addDivider()
    builder.addAmountRow("Subtotal:", safeTicket.subtotal, BODY_STYLE)
    builder.addAmountRow("Kilogramos:", safeTicket.totalKg, BODY_STYLE)
    builder.addAmountRow("Total:", safeTicket.total, TOTAL_BOLD)

    safeTicket.creditNote?.let { note ->
      builder.addDivider()
      builder.addWrapped(note, BODY_STYLE)
    }

    builder.addGap(SECTION_GAP_PX)
    builder.addWrapped(safeTicket.branding.footer, SMALL_CENTER)
    builder.addGap(BOTTOM_PADDING_PX)
    return builder.build()
  }

  internal fun wrapText(text: String, style: TextStyle, maxWidth: Float): List<String> {
    if (!maxWidth.isFinite() || maxWidth <= 0f) invalidTicket("Text width must be positive")
    if (textMeasurer.width("M", style) <= 0f) invalidTicket("Text measurer returned an invalid width")

    val normalized = normalizeDisplayText(text)
    if (normalized.isEmpty()) return listOf("")
    val result = mutableListOf<String>()
    wrapParagraph(normalized, style, maxWidth, result)
    return result.ifEmpty { listOf("") }
  }

  private fun wrapParagraph(
    paragraph: String,
    style: TextStyle,
    maxWidth: Float,
    destination: MutableList<String>,
  ) {
    var current = ""
    paragraph.split(' ').forEach { word ->
      if (measuredWidth(word, style) > maxWidth) {
        if (current.isNotEmpty()) {
          destination += current
          current = ""
        }
        destination += splitWord(word, style, maxWidth)
      } else {
        val candidate = if (current.isEmpty()) word else "$current $word"
        if (measuredWidth(candidate, style) <= maxWidth) {
          current = candidate
        } else {
          destination += current
          current = word
        }
      }
    }
    if (current.isNotEmpty()) destination += current
  }

  private fun splitWord(word: String, style: TextStyle, maxWidth: Float): List<String> {
    val pieces = mutableListOf<String>()
    var start = 0
    while (start < word.length) {
      var end = start + 1
      var largestEnd = -1
      while (end <= word.length) {
        val candidate = word.substring(start, end)
        if (measuredWidth(candidate, style) > maxWidth) break
        largestEnd = end
        end += 1
      }
      if (largestEnd <= start) invalidTicket("A character is wider than the available ticket width")
      pieces += word.substring(start, largestEnd)
      start = largestEnd
    }
    return pieces
  }

  private fun measuredWidth(text: String, style: TextStyle): Float {
    val result = textMeasurer.width(text, style)
    if (!result.isFinite() || result < 0f) invalidTicket("Text measurer returned an invalid width")
    return result
  }

  private inner class LayoutBuilder {
    private val commands = mutableListOf<DrawCommand>()
    private var y = TOP_PADDING_PX.toLong()

    fun addLogo(source: LogoDimensions) {
      if (source.width <= 0 || source.height <= 0) invalidTicket("Logo dimensions must be positive")
      val maxDimension = min(MAX_LOGO_PX, AVAILABLE_WIDTH_PX)
      val scale = min(
        1.0,
        min(maxDimension.toDouble() / source.width, maxDimension.toDouble() / source.height),
      )
      val width = max(1, floor(source.width * scale).toInt())
      val height = max(1, floor(source.height * scale).toInt())
      ensureFits(y + height.toLong())
      commands += DrawCommand.Logo(top = y.toFloat(), width = width, height = height)
      y += height.toLong()
      addGap(SECTION_GAP_PX)
    }

    fun addWrapped(text: String, style: TextStyle) {
      wrapText(text, style, AVAILABLE_WIDTH_PX.toFloat()).forEach { line -> addTextLine(line, style) }
    }

    fun addLabelValue(label: String, value: String, style: TextStyle) {
      val labelStyle = style.copy(bold = true, alignment = TextAlignment.LEFT)
      val valueStyle = style.copy(alignment = TextAlignment.LEFT)
      val labelWidth = measuredWidth(label, labelStyle)
      val sameLineWidth = labelWidth + LABEL_GAP_PX + measuredWidth(value, valueStyle)
      if (sameLineWidth <= AVAILABLE_WIDTH_PX) {
        ensureLine(style.lineHeightPx)
        appendText(label, INSET_PX.toFloat(), baseline(style), labelStyle)
        appendText(
          value,
          INSET_PX + labelWidth + LABEL_GAP_PX,
          baseline(style),
          valueStyle,
        )
        y += style.lineHeightPx.toLong()
      } else {
        addTextLine(label, labelStyle)
        wrapText(value, valueStyle, AVAILABLE_WIDTH_PX.toFloat()).forEach { line ->
          addTextLine(line, valueStyle)
        }
      }
    }

    fun addAmountRow(label: String, amount: String, requestedStyle: TextStyle) {
      val amountStyle = fitAmount(amount, requestedStyle)
      val labelStyle = requestedStyle.copy(bold = true, alignment = TextAlignment.LEFT)
      val amountWidth = measuredWidth(amount, amountStyle)
      val sameLineWidth = measuredWidth(label, labelStyle) + LABEL_GAP_PX + amountWidth
      if (sameLineWidth <= AVAILABLE_WIDTH_PX) {
        val lineHeight = max(labelStyle.lineHeightPx, amountStyle.lineHeightPx)
        ensureLine(lineHeight)
        appendText(label, INSET_PX.toFloat(), baseline(labelStyle), labelStyle)
        appendText(
          amount,
          (WIDTH_PX - INSET_PX).toFloat(),
          baseline(amountStyle),
          amountStyle.copy(alignment = TextAlignment.RIGHT),
        )
        y += lineHeight.toLong()
      } else {
        addWrapped(label, labelStyle)
        addTextLine(amount, amountStyle.copy(alignment = TextAlignment.RIGHT))
      }
    }

    fun addDivider() {
      addGap(DIVIDER_TOP_GAP_PX)
      ensureFits(y + DIVIDER_THICKNESS_PX)
      commands += DrawCommand.Divider(y.toFloat())
      y += DIVIDER_THICKNESS_PX
      addGap(DIVIDER_BOTTOM_GAP_PX)
    }

    fun addGap(pixels: Int) {
      if (pixels < 0) invalidTicket("Layout gaps must not be negative")
      ensureFits(y + pixels.toLong())
      y += pixels.toLong()
    }

    fun build(): TicketLayout {
      if (y <= 0L) invalidTicket("Ticket height must be positive")
      ensureFits(y)
      return TicketLayout(
        width = WIDTH_PX,
        height = y.toInt(),
        commands = Collections.unmodifiableList(ArrayList(commands)),
      )
    }

    private fun addTextLine(text: String, style: TextStyle) {
      ensureLine(style.lineHeightPx)
      val x = when (style.alignment) {
        TextAlignment.LEFT -> INSET_PX.toFloat()
        TextAlignment.CENTER -> WIDTH_PX / 2f
        TextAlignment.RIGHT -> (WIDTH_PX - INSET_PX).toFloat()
      }
      appendText(text, x, baseline(style), style)
      y += style.lineHeightPx.toLong()
    }

    private fun appendText(text: String, x: Float, baseline: Float, style: TextStyle) {
      if (text != normalizeDisplayText(text)) {
        invalidTicket("Layout text must use canonical display whitespace")
      }
      commands += DrawCommand.Text(text, x, baseline, style)
    }

    private fun fitAmount(amount: String, style: TextStyle): TextStyle {
      val startSize = max(style.sizePx, MIN_AMOUNT_SIZE_PX)
      for (size in startSize downTo MIN_AMOUNT_SIZE_PX) {
        val lineHeight = max(size + MIN_TEXT_LEADING_PX, style.lineHeightPx - (style.sizePx - size))
        val candidate = style.copy(sizePx = size, lineHeightPx = lineHeight)
        if (measuredWidth(amount, candidate) <= AVAILABLE_WIDTH_PX) return candidate
      }
      invalidTicket("Amount does not fit at minimum size")
    }

    private fun ensureLine(lineHeight: Int) = ensureFits(y + lineHeight.toLong())

    private fun baseline(style: TextStyle): Float = y.toFloat() + style.sizePx

    private fun ensureFits(endExclusive: Long) {
      if (endExclusive > MAX_HEIGHT_PX.toLong()) {
        ticketTooLarge("Ticket exceeds $MAX_HEIGHT_PX pixels")
      }
    }
  }

  companion object {
    const val WIDTH_PX = 384
    const val MAX_HEIGHT_PX = 6_000
    const val INSET_PX = 8
    const val MAX_LOGO_PX = 256
    const val BODY_SIZE_PX = 20
    const val BODY_LINE_HEIGHT_PX = 26
    const val SMALL_SIZE_PX = 18
    const val SMALL_LINE_HEIGHT_PX = 23
    const val TOTAL_SIZE_PX = 28
    const val TOTAL_LINE_HEIGHT_PX = 34
    const val MIN_AMOUNT_SIZE_PX = 16

    private const val AVAILABLE_WIDTH_PX = WIDTH_PX - 2 * INSET_PX
    private const val TOP_PADDING_PX = 8
    private const val BOTTOM_PADDING_PX = 8
    private const val LABEL_GAP_PX = 8
    private const val SECTION_GAP_PX = 8
    private const val PRODUCT_GAP_PX = 4
    private const val DIVIDER_TOP_GAP_PX = 5
    private const val DIVIDER_BOTTOM_GAP_PX = 7
    private const val DIVIDER_THICKNESS_PX = 1L
    private const val MIN_TEXT_LEADING_PX = 4

    private val BODY_STYLE = TextStyle(BODY_SIZE_PX, BODY_LINE_HEIGHT_PX)
    private val BODY_BOLD = BODY_STYLE.copy(bold = true)
    private val BODY_BOLD_CENTER = BODY_BOLD.copy(alignment = TextAlignment.CENTER)
    private val SMALL_STYLE = TextStyle(SMALL_SIZE_PX, SMALL_LINE_HEIGHT_PX)
    private val SMALL_CENTER = SMALL_STYLE.copy(alignment = TextAlignment.CENTER)
    private val TOTAL_BOLD = TextStyle(TOTAL_SIZE_PX, TOTAL_LINE_HEIGHT_PX, bold = true)
    private val TOTAL_BOLD_CENTER = TOTAL_BOLD.copy(alignment = TextAlignment.CENTER)
  }
}
