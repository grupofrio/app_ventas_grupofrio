package mx.grupofrio.thermalprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DiagnosticTicketFactoryTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val renderer = ThermalTicketRenderer(context)
  private val factory = DiagnosticTicketFactory()

  @Test
  fun `diagnostic keeps supplied identity and includes every calibration label and font size`() {
    val branding = suppliedBranding()

    val ticket = factory.create(branding)
    val layout = renderer.measure(ticket)
    val visibleText = layout.commands.filterIsInstance<DrawCommand.Text>().joinToString(" ") { it.text }
    val sizes = layout.commands.filterIsInstance<DrawCommand.Text>().map { it.style.sizePx }.toSet()
    val textCommands = layout.commands.filterIsInstance<DrawCommand.Text>()

    assertSame(branding, ticket.branding)
    assertTrue(visibleText.contains(branding.legalName))
    assertTrue(visibleText.contains(branding.rfcLabel))
    assertTrue(visibleText.contains("á é í ó ú ñ Ñ $"))
    assertTrue(visibleText.contains("384 dots"))
    assertTrue(visibleText.contains("GS v 0"))
    assertTrue(visibleText.contains("x=0"))
    assertTrue(visibleText.contains("x=383"))
    assertTrue("Rendered diagnostic sizes were $sizes", sizes.containsAll(setOf(16, 18, 20, 28)))
    assertTrue(layout.commands.any { it is DrawCommand.Logo })
    assertTrue(textCommands.any { it.style.alignment == TextAlignment.LEFT })
    assertTrue(textCommands.any { it.style.alignment == TextAlignment.RIGHT })
  }

  @Test
  fun `diagnostic raster marks both edge columns rule and checker and exceeds 64 KiB`() {
    val raster = factory.addCalibrationMarks(renderer.render(factory.create(suppliedBranding())))
    val bits = RasterBits(raster)

    assertEquals(384, raster.width)
    assertTrue(raster.bytes.size > 65_536)
    assertTrue((0 until raster.height).all { y -> bits.isInk(0, y) })
    assertTrue((0 until raster.height).all { y -> bits.isInk(383, y) })
    assertTrue((0 until 384).all { x -> bits.isInk(x, 0) })
    assertTrue((1 until 383).all { x -> bits.isInk(x, 1) == (x % 2 == 0) })

    val bands = EscPosRasterEncoder().bands(raster).toList()
    assertTrue(bands.size >= 3)
    assertTrue(bands.all { band ->
      band.command.take(4).map(Byte::toInt) == listOf(0x1D, 0x76, 0x30, 0x00)
    })
  }

  private fun suppliedBranding() = TicketBranding(
    logoPngBase64 = pngBase64(),
    logoVersion = "supplied-diagnostic-v1",
    legalName = "IDENTIDAD SUMINISTRADA DESDE JS",
    rfcLabel = "RFC: JSU010101AAA",
    title = "CALIBRACIÓN SUMINISTRADA",
    footer = "PIE SUMINISTRADO",
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

  private class RasterBits(private val raster: MonochromeRaster) {
    private val bytes = raster.bytes

    fun isInk(x: Int, y: Int): Boolean {
      val index = y * (raster.width / 8) + x / 8
      return bytes[index].toInt() and (0x80 ushr (x % 8)) != 0
    }
  }
}
