package mx.grupofrio.thermalprinter

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Collections
import kotlin.math.floor

class ThermalTicketDocumentRecord : Record {
  @Field var schemaVersion: Int? = null
  @Field var branding: ThermalTicketBrandingRecord? = null
  @Field var folio: String? = null
  @Field var formattedDate: String? = null
  @Field var customerName: String? = null
  @Field var sellerName: String? = null
  @Field var paymentLabel: String? = null
  @Field var lines: MutableList<ThermalTicketLineRecord>? = null
  @Field var subtotal: String? = null
  @Field var totalKg: String? = null
  @Field var total: String? = null
  @Field var creditNote: String? = null
}

class ThermalTicketBrandingRecord : Record {
  @Field var logoPngBase64: String? = null
  @Field var logoVersion: String? = null
  @Field var legalName: String? = null
  @Field var rfcLabel: String? = null
  @Field var title: String? = null
  @Field var footer: String? = null
}

class ThermalTicketLineRecord : Record {
  @Field var productId: Double? = null
  @Field var productName: String? = null
  @Field var quantityAndUnitPrice: String? = null
  @Field var lineTotal: String? = null
}

data class ThermalTicket(
  val schemaVersion: Int,
  val branding: TicketBranding,
  val folio: String,
  val formattedDate: String,
  val customerName: String,
  val sellerName: String,
  val paymentLabel: String,
  val lines: List<TicketLine>,
  val subtotal: String,
  val totalKg: String,
  val total: String,
  val creditNote: String?,
)

data class TicketBranding(
  val logoPngBase64: String,
  val logoVersion: String,
  val legalName: String,
  val rfcLabel: String,
  val title: String,
  val footer: String,
)

data class TicketLine(
  val productId: Long,
  val productName: String,
  val quantityAndUnitPrice: String,
  val lineTotal: String,
)

fun ThermalTicketDocumentRecord.toDomain(): ThermalTicket {
  val safeSchemaVersion = schemaVersion ?: invalidTicket("schemaVersion is required")
  if (safeSchemaVersion != SUPPORTED_SCHEMA_VERSION) {
    invalidTicket("Unsupported schemaVersion")
  }

  val safeBranding = branding ?: invalidTicket("branding is required")
  val safeLines = lines ?: invalidTicket("lines is required")
  if (safeLines.isEmpty() || safeLines.size > MAX_TICKET_LINES) {
    invalidTicket("lines must contain between 1 and $MAX_TICKET_LINES items")
  }

  // Reject hostile raw input before normalizing strings or copying the mutable record list.
  val budget = DisplayTextBudget()
  preflightBranding(safeBranding, budget)
  budget.required(folio, "folio", MAX_SHORT_TEXT_CHARS)
  budget.required(formattedDate, "formattedDate", MAX_SHORT_TEXT_CHARS)
  budget.required(customerName, "customerName", MAX_TEXT_CHARS)
  budget.required(sellerName, "sellerName", MAX_TEXT_CHARS)
  budget.required(paymentLabel, "paymentLabel", MAX_TEXT_CHARS)
  safeLines.forEachIndexed { index, line -> preflightLine(line, index, budget) }
  budget.required(subtotal, "subtotal", MAX_AMOUNT_CHARS)
  budget.required(totalKg, "totalKg", MAX_AMOUNT_CHARS)
  budget.required(total, "total", MAX_AMOUNT_CHARS)
  budget.optional(creditNote, "creditNote", MAX_LONG_TEXT_CHARS)

  val domainLines = ArrayList<TicketLine>(safeLines.size)
  safeLines.forEachIndexed { index, line -> domainLines += line.toRawDomain(index) }
  return ThermalTicket(
    schemaVersion = safeSchemaVersion,
    branding = safeBranding.toRawDomain(),
    folio = requiredRawText(folio, "folio"),
    formattedDate = requiredRawText(formattedDate, "formattedDate"),
    customerName = requiredRawText(customerName, "customerName"),
    sellerName = requiredRawText(sellerName, "sellerName"),
    paymentLabel = requiredRawText(paymentLabel, "paymentLabel"),
    lines = domainLines,
    subtotal = requiredRawText(subtotal, "subtotal"),
    totalKg = requiredRawText(totalKg, "totalKg"),
    total = requiredRawText(total, "total"),
    creditNote = creditNote,
  ).validatedAndNormalized()
}

private fun preflightBranding(record: ThermalTicketBrandingRecord, budget: DisplayTextBudget) {
  requiredOpaqueText(record.logoPngBase64, "branding.logoPngBase64", MAX_LOGO_BASE64_CHARS)
  requiredIdentifier(record.logoVersion, "branding.logoVersion", MAX_SHORT_TEXT_CHARS)
  budget.required(record.legalName, "branding.legalName", MAX_TEXT_CHARS)
  budget.required(record.rfcLabel, "branding.rfcLabel", MAX_TEXT_CHARS)
  budget.required(record.title, "branding.title", MAX_TEXT_CHARS)
  budget.required(record.footer, "branding.footer", MAX_LONG_TEXT_CHARS)
}

private fun ThermalTicketBrandingRecord.toRawDomain(): TicketBranding = TicketBranding(
  logoPngBase64 = requiredRawText(logoPngBase64, "branding.logoPngBase64"),
  logoVersion = requiredRawText(logoVersion, "branding.logoVersion"),
  legalName = requiredRawText(legalName, "branding.legalName"),
  rfcLabel = requiredRawText(rfcLabel, "branding.rfcLabel"),
  title = requiredRawText(title, "branding.title"),
  footer = requiredRawText(footer, "branding.footer"),
)

private fun preflightLine(record: ThermalTicketLineRecord, index: Int, budget: DisplayTextBudget) {
  record.validProductId(index)
  budget.required(record.productName, "lines[$index].productName", MAX_TEXT_CHARS)
  budget.required(
    record.quantityAndUnitPrice,
    "lines[$index].quantityAndUnitPrice",
    MAX_TEXT_CHARS,
  )
  budget.required(record.lineTotal, "lines[$index].lineTotal", MAX_AMOUNT_CHARS)
}

private fun ThermalTicketLineRecord.validProductId(index: Int): Long {
  val safeProductId = productId ?: invalidTicket("lines[$index].productId is required")
  if (!safeProductId.isFinite() || safeProductId <= 0.0 || safeProductId > MAX_SAFE_INTEGER ||
    floor(safeProductId) != safeProductId
  ) {
    invalidTicket("lines[$index].productId must be a positive safe integer")
  }
  return safeProductId.toLong()
}

private fun ThermalTicketLineRecord.toRawDomain(index: Int): TicketLine = TicketLine(
  productId = validProductId(index),
  productName = requiredRawText(productName, "lines[$index].productName"),
  quantityAndUnitPrice = requiredRawText(
    quantityAndUnitPrice,
    "lines[$index].quantityAndUnitPrice",
  ),
  lineTotal = requiredRawText(lineTotal, "lines[$index].lineTotal"),
)

/**
 * Printer display policy: whitespace, Unicode separators, controls, and FORMAT code points become
 * one ASCII-space separator; separator runs collapse and surrounding separators disappear.
 * Required/optional validation happens afterward. Valid supplementary code points are preserved;
 * an isolated UTF-16 surrogate is invalid instead of being silently rewritten. Opaque base64 and
 * identifiers deliberately use separate validators below.
 */
internal fun normalizeDisplayText(value: String): String {
  val normalized = StringBuilder(minOf(value.length, MAX_NORMALIZED_TEXT_CAPACITY))
  var separatorPending = false
  value.forEachUnicodeCodePoint { codePoint ->
    if (isDisplaySeparator(codePoint)) {
      separatorPending = normalized.isNotEmpty()
    } else {
      if (separatorPending) normalized.append(' ')
      normalized.appendCodePoint(codePoint)
      separatorPending = false
    }
  }
  return normalized.toString()
}

private fun requiredDisplayText(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (!validateRawDisplayText(safeValue, field, maxChars)) {
    invalidTicket("$field must not be blank")
  }
  val normalized = normalizeDisplayText(safeValue)
  if (normalized.isEmpty()) invalidTicket("$field must not be blank")
  validateDisplayText(normalized, field, maxChars)
  return normalized
}

private fun optionalDisplayText(value: String?, field: String, maxChars: Int): String? {
  if (value == null) return null
  validateRawDisplayText(value, field, maxChars)
  val normalized = normalizeDisplayText(value)
  if (normalized.isEmpty()) return null
  validateDisplayText(normalized, field, maxChars)
  return normalized
}

private fun validateRawDisplayText(value: String, field: String, maxChars: Int): Boolean {
  if (value.length > maxChars) invalidTicket("$field is too long")
  var hasDisplayContent = false
  value.forEachUnicodeCodePoint { codePoint ->
    if (!isDisplaySeparator(codePoint)) hasDisplayContent = true
  }
  return hasDisplayContent
}

private fun validateDisplayText(value: String, field: String, maxChars: Int) {
  if (value.length > maxChars) invalidTicket("$field is too long")
  value.forEachUnicodeCodePoint { codePoint ->
    if (codePoint != ASCII_SPACE && isDisplaySeparator(codePoint)) {
      invalidTicket("$field contains non-canonical display separators")
    }
  }
}

/** Base64 is opaque at the record boundary; canonical PNG validation belongs to the renderer. */
private fun requiredOpaqueText(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (safeValue.length > maxChars) invalidTicket("$field is too long")
  if (safeValue.isBlank()) invalidTicket("$field must not be blank")
  return safeValue
}

/** Identifiers are never whitespace-normalized because that could silently change cache identity. */
private fun requiredIdentifier(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (safeValue.length > maxChars) invalidTicket("$field is too long")
  if (safeValue.isBlank()) invalidTicket("$field must not be blank")
  safeValue.forEachUnicodeCodePoint { codePoint ->
    if (isDisplaySeparator(codePoint)) {
      invalidTicket("$field contains unsafe identifier code points")
    }
  }
  return safeValue
}

private fun requiredRawText(value: String?, field: String): String =
  value ?: invalidTicket("$field is required")

private class DisplayTextBudget {
  private var totalChars = 0L

  fun required(value: String?, field: String, maxChars: Int) {
    val safeValue = value ?: invalidTicket("$field is required")
    if (!add(safeValue, field, maxChars)) invalidTicket("$field must not be blank")
  }

  fun optional(value: String?, field: String, maxChars: Int) {
    if (value != null) add(value, field, maxChars)
  }

  private fun add(value: String, field: String, maxChars: Int): Boolean {
    val hasDisplayContent = validateRawDisplayText(value, field, maxChars)
    totalChars += value.length.toLong()
    if (totalChars > MAX_AGGREGATE_DISPLAY_TEXT_CHARS) {
      invalidTicket("Ticket display text is too long")
    }
    return hasDisplayContent
  }
}

private inline fun String.forEachUnicodeCodePoint(action: (Int) -> Unit) {
  var index = 0
  while (index < length) {
    val codePoint = Character.codePointAt(this, index)
    if (Character.getType(codePoint) == Character.SURROGATE.toInt()) {
      invalidTicket("Text contains an isolated UTF-16 surrogate")
    }
    action(codePoint)
    index += Character.charCount(codePoint)
  }
}

private fun isDisplaySeparator(codePoint: Int): Boolean {
  val type = Character.getType(codePoint)
  return Character.isWhitespace(codePoint) ||
    Character.isSpaceChar(codePoint) ||
    type == Character.CONTROL.toInt() ||
    type == Character.FORMAT.toInt() ||
    type == Character.LINE_SEPARATOR.toInt() ||
    type == Character.PARAGRAPH_SEPARATOR.toInt()
}

/**
 * Layout also accepts immutable domain fixtures directly in tests/native code. Reapplying this
 * idempotent copy keeps every generated Text command under the same display policy.
 */
internal fun ThermalTicket.normalizedForLayout(): ThermalTicket = validatedAndNormalized()

private fun ThermalTicket.validatedAndNormalized(): ThermalTicket {
  if (schemaVersion != SUPPORTED_SCHEMA_VERSION) invalidTicket("Unsupported schemaVersion")
  if (lines.isEmpty() || lines.size > MAX_TICKET_LINES) {
    invalidTicket("lines must contain between 1 and $MAX_TICKET_LINES items")
  }

  val budget = DisplayTextBudget()
  requiredOpaqueText(
    branding.logoPngBase64,
    "branding.logoPngBase64",
    MAX_LOGO_BASE64_CHARS,
  )
  requiredIdentifier(branding.logoVersion, "branding.logoVersion", MAX_SHORT_TEXT_CHARS)
  budget.required(branding.legalName, "branding.legalName", MAX_TEXT_CHARS)
  budget.required(branding.rfcLabel, "branding.rfcLabel", MAX_TEXT_CHARS)
  budget.required(branding.title, "branding.title", MAX_TEXT_CHARS)
  budget.required(branding.footer, "branding.footer", MAX_LONG_TEXT_CHARS)
  budget.required(folio, "folio", MAX_SHORT_TEXT_CHARS)
  budget.required(formattedDate, "formattedDate", MAX_SHORT_TEXT_CHARS)
  budget.required(customerName, "customerName", MAX_TEXT_CHARS)
  budget.required(sellerName, "sellerName", MAX_TEXT_CHARS)
  budget.required(paymentLabel, "paymentLabel", MAX_TEXT_CHARS)
  lines.forEachIndexed { index, line ->
    if (line.productId <= 0L || line.productId.toDouble() > MAX_SAFE_INTEGER) {
      invalidTicket("lines[$index].productId must be a positive safe integer")
    }
    budget.required(line.productName, "lines[$index].productName", MAX_TEXT_CHARS)
    budget.required(
      line.quantityAndUnitPrice,
      "lines[$index].quantityAndUnitPrice",
      MAX_TEXT_CHARS,
    )
    budget.required(line.lineTotal, "lines[$index].lineTotal", MAX_AMOUNT_CHARS)
  }
  budget.required(subtotal, "subtotal", MAX_AMOUNT_CHARS)
  budget.required(totalKg, "totalKg", MAX_AMOUNT_CHARS)
  budget.required(total, "total", MAX_AMOUNT_CHARS)
  budget.optional(creditNote, "creditNote", MAX_LONG_TEXT_CHARS)

  val normalizedLines = ArrayList<TicketLine>(lines.size)
  lines.forEachIndexed { index, line ->
    normalizedLines += line.copy(
      productName = requiredDisplayText(
        line.productName,
        "lines[$index].productName",
        MAX_TEXT_CHARS,
      ),
      quantityAndUnitPrice = requiredDisplayText(
        line.quantityAndUnitPrice,
        "lines[$index].quantityAndUnitPrice",
        MAX_TEXT_CHARS,
      ),
      lineTotal = requiredDisplayText(
        line.lineTotal,
        "lines[$index].lineTotal",
        MAX_AMOUNT_CHARS,
      ),
    )
  }

  return copy(
    branding = branding.copy(
      logoPngBase64 = requiredOpaqueText(
        branding.logoPngBase64,
        "branding.logoPngBase64",
        MAX_LOGO_BASE64_CHARS,
      ),
      logoVersion = requiredIdentifier(
        branding.logoVersion,
        "branding.logoVersion",
        MAX_SHORT_TEXT_CHARS,
      ),
      legalName = requiredDisplayText(branding.legalName, "branding.legalName", MAX_TEXT_CHARS),
      rfcLabel = requiredDisplayText(branding.rfcLabel, "branding.rfcLabel", MAX_TEXT_CHARS),
      title = requiredDisplayText(branding.title, "branding.title", MAX_TEXT_CHARS),
      footer = requiredDisplayText(branding.footer, "branding.footer", MAX_LONG_TEXT_CHARS),
    ),
    folio = requiredDisplayText(folio, "folio", MAX_SHORT_TEXT_CHARS),
    formattedDate = requiredDisplayText(formattedDate, "formattedDate", MAX_SHORT_TEXT_CHARS),
    customerName = requiredDisplayText(customerName, "customerName", MAX_TEXT_CHARS),
    sellerName = requiredDisplayText(sellerName, "sellerName", MAX_TEXT_CHARS),
    paymentLabel = requiredDisplayText(paymentLabel, "paymentLabel", MAX_TEXT_CHARS),
    lines = immutableList(normalizedLines),
    subtotal = requiredDisplayText(subtotal, "subtotal", MAX_AMOUNT_CHARS),
    totalKg = requiredDisplayText(totalKg, "totalKg", MAX_AMOUNT_CHARS),
    total = requiredDisplayText(total, "total", MAX_AMOUNT_CHARS),
    creditNote = optionalDisplayText(creditNote, "creditNote", MAX_LONG_TEXT_CHARS),
  )
}

private fun <T> immutableList(values: List<T>): List<T> =
  Collections.unmodifiableList(ArrayList(values))

private const val SUPPORTED_SCHEMA_VERSION = 1
private const val MAX_TICKET_LINES = 500
private const val MAX_SHORT_TEXT_CHARS = 256
private const val MAX_AMOUNT_CHARS = 256
private const val MAX_TEXT_CHARS = 8_192
private const val MAX_LONG_TEXT_CHARS = 16_384
private const val MAX_NORMALIZED_TEXT_CAPACITY = MAX_LONG_TEXT_CHARS
private const val MAX_AGGREGATE_DISPLAY_TEXT_CHARS = 32_768L
internal const val MAX_LOGO_BASE64_CHARS = 2_800_000
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
private const val ASCII_SPACE = 0x20
