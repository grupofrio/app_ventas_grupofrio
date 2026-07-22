package mx.grupofrio.thermalprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayOutputStream
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LongSaleTicketPayloadTest {
  @Test
  fun `shared long sale fixture renders to more than 64 KiB independently of diagnostic`() {
    val resource = requireNotNull(javaClass.getResourceAsStream("/mp210-long-sale-ticket.json")) {
      "fixtures/mp210-long-sale-ticket.json must be available as a Gradle test resource"
    }
    val source = resource.bufferedReader(Charsets.UTF_8).use { it.readText() }
    val json = JSONObject(source)
    val ticket = json.toThermalTicket(branding())
    val context = ApplicationProvider.getApplicationContext<Context>()

    val raster = ThermalTicketRenderer(context).render(ticket)

    assertEquals(384, raster.width)
    assertEquals(48 * raster.height, raster.bytes.size)
    assertTrue("Long sale payload was only ${raster.bytes.size} bytes", raster.bytes.size > 65_536)
    assertTrue(ticket.lines.size >= 30)
    assertTrue(ticket.folio.startsWith("VENTA-"))
    assertTrue(ticket.creditNote.orEmpty().contains("Pagaré"))
  }

  private fun JSONObject.toThermalTicket(branding: TicketBranding): ThermalTicket {
    val jsonLines = getJSONArray("lines")
    val lines = ArrayList<TicketLine>(jsonLines.length())
    for (index in 0 until jsonLines.length()) {
      val line = jsonLines.getJSONObject(index)
      lines += TicketLine(
        productId = line.getLong("productId"),
        productName = line.getString("productName"),
        quantityAndUnitPrice = line.getString("quantityAndUnitPrice"),
        lineTotal = line.getString("lineTotal"),
      )
    }
    return ThermalTicket(
      schemaVersion = getInt("schemaVersion"),
      branding = branding,
      folio = getString("folio"),
      formattedDate = getString("formattedDate"),
      customerName = getString("customerName"),
      sellerName = getString("sellerName"),
      paymentLabel = getString("paymentLabel"),
      lines = lines,
      subtotal = getString("subtotal"),
      totalKg = getString("totalKg"),
      total = getString("total"),
      creditNote = optString("creditNote").takeIf(String::isNotEmpty),
    )
  }

  private fun branding() = TicketBranding(
    logoPngBase64 = pngBase64(),
    logoVersion = "long-sale-test-v1",
    legalName = "Identidad de prueba inyectada",
    rfcLabel = "RFC: TST010101AAA",
    title = "Ticket de venta",
    footer = "Gracias por su compra",
  )

  private fun pngBase64(): String {
    val bitmap = Bitmap.createBitmap(24, 12, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.BLACK)
    return try {
      val output = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
      Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    } finally {
      bitmap.recycle()
    }
  }
}
