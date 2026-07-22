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
    folio = requiredText(folio, "folio", MAX_SHORT_TEXT_CHARS),
    formattedDate = requiredText(formattedDate, "formattedDate", MAX_SHORT_TEXT_CHARS),
    customerName = requiredText(customerName, "customerName", MAX_TEXT_CHARS),
    sellerName = requiredText(sellerName, "sellerName", MAX_TEXT_CHARS),
    paymentLabel = requiredText(paymentLabel, "paymentLabel", MAX_TEXT_CHARS),
    lines = immutableList(domainLines),
    subtotal = requiredText(subtotal, "subtotal", MAX_AMOUNT_CHARS),
    totalKg = requiredText(totalKg, "totalKg", MAX_AMOUNT_CHARS),
    total = requiredText(total, "total", MAX_AMOUNT_CHARS),
    creditNote = optionalText(creditNote, "creditNote", MAX_LONG_TEXT_CHARS),
  )
}

private fun ThermalTicketBrandingRecord.toDomain(): TicketBranding = TicketBranding(
  logoPngBase64 = requiredText(
    logoPngBase64,
    "branding.logoPngBase64",
    MAX_LOGO_BASE64_CHARS,
  ),
  logoVersion = requiredText(logoVersion, "branding.logoVersion", MAX_SHORT_TEXT_CHARS),
  legalName = requiredText(legalName, "branding.legalName", MAX_TEXT_CHARS),
  rfcLabel = requiredText(rfcLabel, "branding.rfcLabel", MAX_TEXT_CHARS),
  title = requiredText(title, "branding.title", MAX_TEXT_CHARS),
  footer = requiredText(footer, "branding.footer", MAX_LONG_TEXT_CHARS),
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
    productName = requiredText(productName, "lines[$index].productName", MAX_TEXT_CHARS),
    quantityAndUnitPrice = requiredText(
      quantityAndUnitPrice,
      "lines[$index].quantityAndUnitPrice",
      MAX_TEXT_CHARS,
    ),
    lineTotal = requiredText(lineTotal, "lines[$index].lineTotal", MAX_AMOUNT_CHARS),
  )
}

private fun requiredText(value: String?, field: String, maxChars: Int): String {
  val safeValue = value ?: invalidTicket("$field is required")
  if (safeValue.isBlank()) invalidTicket("$field must not be blank")
  validateText(safeValue, field, maxChars)
  return safeValue
}

private fun optionalText(value: String?, field: String, maxChars: Int): String? {
  if (value == null) return null
  if (value.isBlank()) invalidTicket("$field must not be blank when present")
  validateText(value, field, maxChars)
  return value
}

private fun validateText(value: String, field: String, maxChars: Int) {
  if (value.length > maxChars) invalidTicket("$field is too long")
  if (value.any { it == '\u0000' || (it < ' ' && it != '\n' && it != '\r' && it != '\t') }) {
    invalidTicket("$field contains unsupported control characters")
  }
}

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
