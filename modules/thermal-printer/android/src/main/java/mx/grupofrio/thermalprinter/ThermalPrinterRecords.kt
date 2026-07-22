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

/** A stable code plus safe message that later module tasks can map to an Expo rejection. */
class ThermalPrinterException(
  val code: String,
  message: String,
) : IllegalArgumentException(message)

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

  val domainLines = safeLines.mapIndexed { index, line -> line.toDomain(index) }
  return ThermalTicket(
    schemaVersion = safeSchemaVersion,
    branding = safeBranding.toDomain(),
    folio = requiredDisplayText(folio, "folio", MAX_SHORT_TEXT_CHARS),
    formattedDate = requiredDisplayText(formattedDate, "formattedDate", MAX_SHORT_TEXT_CHARS),
    customerName = requiredDisplayText(customerName, "customerName", MAX_TEXT_CHARS),
    sellerName = requiredDisplayText(sellerName, "sellerName", MAX_TEXT_CHARS),
    paymentLabel = requiredDisplayText(paymentLabel, "paymentLabel", MAX_TEXT_CHARS),
    lines = immutableList(domainLines),
    subtotal = requiredDisplayText(subtotal, "subtotal", MAX_AMOUNT_CHARS),
    totalKg = requiredDisplayText(totalKg, "totalKg", MAX_AMOUNT_CHARS),
    total = requiredDisplayText(total, "total", MAX_AMOUNT_CHARS),
    creditNote = optionalDisplayText(creditNote, "creditNote", MAX_LONG_TEXT_CHARS),
  )
}

private fun ThermalTicketBrandingRecord.toDomain(): TicketBranding = TicketBranding(
  logoPngBase64 = requiredOpaqueText(
    logoPngBase64,
    "branding.logoPngBase64",
    MAX_LOGO_BASE64_CHARS,
  ),
  logoVersion = requiredIdentifier(logoVersion, "branding.logoVersion", MAX_SHORT_TEXT_CHARS),
  legalName = requiredDisplayText(legalName, "branding.legalName", MAX_TEXT_CHARS),
  rfcLabel = requiredDisplayText(rfcLabel, "branding.rfcLabel", MAX_TEXT_CHARS),
  title = requiredDisplayText(title, "branding.title", MAX_TEXT_CHARS),
  footer = requiredDisplayText(footer, "branding.footer", MAX_LONG_TEXT_CHARS),
)

private fun ThermalTicketLineRecord.toDomain(index: Int): TicketLine {
  val safeProductId = productId ?: invalidTicket("lines[$index].productId is required")
  if (!safeProductId.isFinite() || safeProductId < 0.0 || safeProductId > MAX_SAFE_INTEGER ||
    floor(safeProductId) != safeProductId
  ) {
    invalidTicket("lines[$index].productId must be a non-negative safe integer")
  }

  return TicketLine(
    productId = safeProductId.toLong(),
    productName = requiredDisplayText(productName, "lines[$index].productName", MAX_TEXT_CHARS),
    quantityAndUnitPrice = requiredDisplayText(
      quantityAndUnitPrice,
      "lines[$index].quantityAndUnitPrice",
      MAX_TEXT_CHARS,
    ),
    lineTotal = requiredDisplayText(lineTotal, "lines[$index].lineTotal", MAX_AMOUNT_CHARS),
  )
}

/**
 * Printer display policy: CR/LF/TAB become spaces, every whitespace run collapses to one space,
 * and surrounding whitespace is removed. Required/optional validation happens after this step.
 * Opaque base64 and identifiers deliberately use separate validators below.
 */
internal fun normalizeDisplayText(value: String): String = buildString(value.length) {
  var spacePending = false
  value.forEach { character ->
    if (character.isWhitespace() || character == '\u00A0') {
      spacePending = isNotEmpty()
    } else {
      if (spacePending) append(' ')
      append(character)
      spacePending = false
    }
  }
}

private fun requiredDisplayText(value: String?, field: String, maxChars: Int): String {
  val normalized = normalizeDisplayText(value ?: invalidTicket("$field is required"))
  if (normalized.isEmpty()) invalidTicket("$field must not be blank")
  validateDisplayText(normalized, field, maxChars)
  return normalized
}

private fun optionalDisplayText(value: String?, field: String, maxChars: Int): String? {
  if (value == null) return null
  val normalized = normalizeDisplayText(value)
  if (normalized.isEmpty()) return null
  validateDisplayText(normalized, field, maxChars)
  return normalized
}

private fun validateDisplayText(value: String, field: String, maxChars: Int) {
  if (value.length > maxChars) invalidTicket("$field is too long")
  if (value.any { Character.isISOControl(it.code) }) {
    invalidTicket("$field contains unsupported control characters")
  }
}

/** Base64 is opaque at the record boundary; canonical PNG validation belongs to the renderer. */
private fun requiredOpaqueText(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (safeValue.isBlank()) invalidTicket("$field must not be blank")
  if (safeValue.length > maxChars) invalidTicket("$field is too long")
  return safeValue
}

/** Identifiers are never whitespace-normalized because that could silently change cache identity. */
private fun requiredIdentifier(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (safeValue.isBlank()) invalidTicket("$field must not be blank")
  if (safeValue.length > maxChars) invalidTicket("$field is too long")
  if (safeValue.any { it.isWhitespace() || Character.isISOControl(it.code) }) {
    invalidTicket("$field contains invalid identifier whitespace")
  }
  return safeValue
}

/**
 * Layout also accepts immutable domain fixtures directly in tests/native code. Reapplying this
 * idempotent copy keeps every generated Text command under the same display policy.
 */
internal fun ThermalTicket.normalizedForLayout(): ThermalTicket = copy(
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
  lines = immutableList(
    lines.mapIndexed { index, line ->
      line.copy(
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
    },
  ),
  subtotal = requiredDisplayText(subtotal, "subtotal", MAX_AMOUNT_CHARS),
  totalKg = requiredDisplayText(totalKg, "totalKg", MAX_AMOUNT_CHARS),
  total = requiredDisplayText(total, "total", MAX_AMOUNT_CHARS),
  creditNote = optionalDisplayText(creditNote, "creditNote", MAX_LONG_TEXT_CHARS),
)

private fun <T> immutableList(values: List<T>): List<T> =
  Collections.unmodifiableList(ArrayList(values))

internal fun invalidTicket(message: String): Nothing =
  throw ThermalPrinterException(INVALID_TICKET_CODE, message)

internal fun ticketTooLarge(message: String): Nothing =
  throw ThermalPrinterException(TICKET_TOO_LARGE_CODE, message)

internal const val INVALID_TICKET_CODE = "invalid_ticket"
internal const val TICKET_TOO_LARGE_CODE = "ticket_too_large"

private const val SUPPORTED_SCHEMA_VERSION = 1
private const val MAX_TICKET_LINES = 500
private const val MAX_SHORT_TEXT_CHARS = 256
private const val MAX_AMOUNT_CHARS = 256
private const val MAX_TEXT_CHARS = 8_192
private const val MAX_LONG_TEXT_CHARS = 16_384
internal const val MAX_LOGO_BASE64_CHARS = 2_800_000
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
