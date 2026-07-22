package mx.grupofrio.thermalprinter

import android.content.Context
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.util.Base64
import java.security.MessageDigest

internal fun interface RenderBitmapAllocator {
  fun create(width: Int, height: Int): Bitmap
}

internal fun interface LogoBitmapLeaseFactory {
  fun copy(source: Bitmap): Bitmap
}

internal interface FontProvider {
  fun typeface(bold: Boolean): Typeface
}

internal class PackagedFontProvider(private val assets: AssetManager) : FontProvider {
  private val regular by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
    Typeface.createFromAsset(assets, REGULAR_ASSET)
  }
  private val bold by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
    Typeface.createFromAsset(assets, BOLD_ASSET)
  }

  override fun typeface(bold: Boolean): Typeface = if (bold) this.bold else regular

  private companion object {
    const val REGULAR_ASSET = "fonts/SpaceMono-Regular.ttf"
    const val BOLD_ASSET = "fonts/SpaceMono-Bold.ttf"
  }
}

internal class ThermalTicketRenderer(
  context: Context,
  private val bitmapAllocator: RenderBitmapAllocator = RenderBitmapAllocator { width, height ->
    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  },
  private val fontProvider: FontProvider = PackagedFontProvider(context.assets),
  private val logoBitmapLeaseFactory: LogoBitmapLeaseFactory = LogoBitmapLeaseFactory { source ->
    source.copy(Bitmap.Config.ARGB_8888, false)
      ?: invalidTicket("Cached logo could not be copied")
  },
) {
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isDither = false
    isSubpixelText = false
  }
  private val layoutEngine = ThermalTicketLayout { text, style ->
    configureTextPaint(style)
    val metrics = textPaint.fontMetrics
    TextMeasurement(
      width = textPaint.measureText(text),
      top = metrics.top,
      bottom = metrics.bottom,
    )
  }

  // A single entry makes ownership simple and prevents logo versions from growing memory forever.
  private var cachedLogo: CachedLogo? = null

  @Synchronized
  fun measure(ticket: ThermalTicket): TicketLayout {
    val logo = inspectLogo(ticket.branding.logoPngBase64)
    return layoutEngine.layout(ticket, logo.dimensions)
  }

  @Synchronized
  fun render(ticket: ThermalTicket): MonochromeRaster = render(ticket) { it }

  /** Internal rendering seam used to prove that a missing command cannot borrow adjacent ink. */
  @Synchronized
  internal fun render(
    ticket: ThermalTicket,
    layoutTransform: (TicketLayout) -> TicketLayout,
  ): MonochromeRaster {
    val inspectedLogo = inspectLogo(ticket.branding.logoPngBase64)
    val layout = layoutTransform(layoutEngine.layout(ticket, inspectedLogo.dimensions))
    validateLayoutBeforeAllocation(layout)
    val logoCommand = layout.commands.filterIsInstance<DrawCommand.Logo>().singleOrNull()
      ?: invalidTicket("Ticket layout must contain exactly one logo")
    val logo = logoLease(
      ticket.branding.logoVersion,
      inspectedLogo,
      LogoDimensions(logoCommand.width, logoCommand.height),
    )

    try {
      val renderBitmap = bitmapAllocator.create(layout.width, layout.height)
      try {
        if (renderBitmap.width != layout.width || renderBitmap.height != layout.height ||
          renderBitmap.config != Bitmap.Config.ARGB_8888
        ) {
          invalidTicket("Render bitmap does not match the required ARGB layout")
        }
        renderBitmap.eraseColor(Color.WHITE)
        draw(Canvas(renderBitmap), layout, logo)
        return toMonochromeRaster(renderBitmap)
      } finally {
        if (!renderBitmap.isRecycled) renderBitmap.recycle()
      }
    } finally {
      if (!logo.isRecycled) logo.recycle()
    }
  }

  private fun validateLayoutBeforeAllocation(layout: TicketLayout) {
    if (layout.width != ThermalTicketLayout.WIDTH_PX) {
      invalidTicket("Ticket layout width must be ${ThermalTicketLayout.WIDTH_PX}")
    }
    if (layout.height <= 0) invalidTicket("Ticket layout height must be positive")
    if (layout.height > ThermalTicketLayout.MAX_HEIGHT_PX) {
      ticketTooLarge("Ticket exceeds ${ThermalTicketLayout.MAX_HEIGHT_PX} pixels")
    }
  }

  private fun draw(canvas: Canvas, layout: TicketLayout, logo: Bitmap) {
    layout.commands.forEach { command ->
      when (command) {
        is DrawCommand.Text -> drawText(canvas, command)
        is DrawCommand.Divider -> drawDivider(canvas, command)
        is DrawCommand.Logo -> drawLogo(canvas, command, logo)
      }
    }
  }

  private fun drawText(canvas: Canvas, command: DrawCommand.Text) {
    configureTextPaint(command.style)
    canvas.drawText(command.text, command.x, command.baseline, textPaint)
  }

  private fun drawDivider(canvas: Canvas, command: DrawCommand.Divider) {
    val dividerPaint = Paint().apply {
      color = Color.BLACK
      style = Paint.Style.FILL
      isAntiAlias = false
      isDither = false
    }
    // Rect's right edge is exclusive, so this fills the exact x=0..383 printer row.
    canvas.drawRect(
      0f,
      command.y,
      ThermalTicketLayout.WIDTH_PX.toFloat(),
      command.y + 1f,
      dividerPaint,
    )
  }

  private fun drawLogo(canvas: Canvas, command: DrawCommand.Logo, logo: Bitmap) {
    if (command.width <= 0 || command.height <= 0 ||
      command.width > ThermalTicketLayout.MAX_LOGO_PX ||
      command.height > ThermalTicketLayout.MAX_LOGO_PX
    ) {
      invalidTicket("Logo draw command is outside permitted bounds")
    }
    val left = (ThermalTicketLayout.WIDTH_PX - command.width) / 2
    val top = command.top.toInt()
    val right = left + command.width
    val bottom = top + command.height
    if (left < ThermalTicketLayout.INSET_PX || right > ThermalTicketLayout.WIDTH_PX - ThermalTicketLayout.INSET_PX ||
      top < 0 || bottom > canvas.height
    ) {
      invalidTicket("Logo draw command would be clipped")
    }

    val logoPaint = Paint().apply {
      isAntiAlias = false
      isDither = false
      isFilterBitmap = false
    }
    if (logo.width != command.width || logo.height != command.height) {
      invalidTicket("Cached logo does not match its draw command")
    }
    canvas.drawBitmap(logo, left.toFloat(), top.toFloat(), logoPaint)
  }

  private fun configureTextPaint(style: TextStyle) {
    textPaint.textSize = style.sizePx.toFloat()
    textPaint.typeface = fontProvider.typeface(style.bold)
    textPaint.textAlign = when (style.alignment) {
      TextAlignment.LEFT -> Paint.Align.LEFT
      TextAlignment.CENTER -> Paint.Align.CENTER
      TextAlignment.RIGHT -> Paint.Align.RIGHT
    }
  }

  private fun inspectLogo(encoded: String): InspectedLogo {
    if (encoded.isBlank()) invalidTicket("Logo base64 is required")
    if (encoded.length > MAX_LOGO_BASE64_CHARS) invalidTicket("Encoded logo is too large")
    if (encoded.length % BASE64_QUANTUM != 0 || !BASE64_PATTERN.matches(encoded)) {
      invalidTicket("Logo is not canonical base64")
    }

    val padding = encoded.takeLastWhile { it == '=' }.length
    val estimatedDecodedBytes = encoded.length.toLong() / BASE64_QUANTUM * 3L - padding
    if (estimatedDecodedBytes <= 0L || estimatedDecodedBytes > MAX_DECODED_LOGO_BYTES) {
      invalidTicket("Decoded logo is too large")
    }

    val bytes = try {
      Base64.decode(encoded, Base64.NO_WRAP)
    } catch (error: IllegalArgumentException) {
      invalidTicket("Logo base64 is malformed")
    }
    if (bytes.size.toLong() != estimatedDecodedBytes || bytes.size > MAX_DECODED_LOGO_BYTES) {
      invalidTicket("Decoded logo length is invalid")
    }
    if (!hasPngSignature(bytes)) invalidTicket("Logo must be a PNG image")

    val options = BitmapFactory.Options().apply {
      inJustDecodeBounds = true
      inScaled = false
    }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    validateLogoDimensions(options.outWidth, options.outHeight)
    return InspectedLogo(
      bytes = bytes,
      digest = MessageDigest.getInstance(SHA_256).digest(bytes),
      dimensions = LogoDimensions(options.outWidth, options.outHeight),
    )
  }

  private fun validateLogoDimensions(width: Int, height: Int) {
    if (width <= 0 || height <= 0 || width > MAX_SOURCE_LOGO_DIMENSION ||
      height > MAX_SOURCE_LOGO_DIMENSION
    ) {
      invalidTicket("Logo dimensions are invalid")
    }
    val pixels = width.toLong() * height.toLong()
    if (pixels > MAX_SOURCE_LOGO_PIXELS) invalidTicket("Logo has too many pixels")
  }

  private fun logoLease(
    version: String,
    inspected: InspectedLogo,
    target: LogoDimensions,
  ): Bitmap {
    if (version.isBlank() || version.length > MAX_LOGO_VERSION_CHARS) {
      invalidTicket("Logo version is invalid")
    }
    val current = cachedLogo
    if (current?.version == version && !current.digest.contentEquals(inspected.digest)) {
      invalidTicket("Logo version is already bound to different PNG content")
    }
    if (current != null && current.version == version &&
      current.digest.contentEquals(inspected.digest) && current.target == target
    ) {
      return leaseCopy(current.bitmap, target)
    }

    val options = BitmapFactory.Options().apply {
      inJustDecodeBounds = false
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inScaled = false
    }
    val decoded = BitmapFactory.decodeByteArray(inspected.bytes, 0, inspected.bytes.size, options)
      ?: invalidTicket("Logo PNG could not be decoded")
    if (decoded.width != inspected.dimensions.width || decoded.height != inspected.dimensions.height) {
      decoded.recycle()
      invalidTicket("Decoded logo dimensions changed unexpectedly")
    }

    var scaled: Bitmap? = null
    try {
      scaled = Bitmap.createScaledBitmap(decoded, target.width, target.height, false)
    } finally {
      if (scaled !== decoded && !decoded.isRecycled) decoded.recycle()
    }
    val cachedBitmap = scaled ?: invalidTicket("Logo scaling failed")
    if (cachedBitmap.width != target.width || cachedBitmap.height != target.height ||
      cachedBitmap.config != Bitmap.Config.ARGB_8888
    ) {
      cachedBitmap.recycle()
      invalidTicket("Scaled logo dimensions are invalid")
    }

    val previous = cachedLogo
    cachedLogo = CachedLogo(version, inspected.digest.copyOf(), target, cachedBitmap)
    if (previous != null && previous.bitmap !== cachedBitmap && !previous.bitmap.isRecycled) {
      previous.bitmap.recycle()
    }
    return leaseCopy(cachedBitmap, target)
  }

  private fun leaseCopy(source: Bitmap, target: LogoDimensions): Bitmap {
    if (source.isRecycled) invalidTicket("Cached logo is no longer available")
    val lease = logoBitmapLeaseFactory.copy(source)
    if (lease === source) invalidTicket("Logo lease must own a distinct bitmap")
    if (lease.isRecycled || lease.width != target.width || lease.height != target.height ||
      lease.config != Bitmap.Config.ARGB_8888
    ) {
      if (!lease.isRecycled) lease.recycle()
      invalidTicket("Logo lease does not match its draw command")
    }
    return lease
  }

  private fun toMonochromeRaster(bitmap: Bitmap): MonochromeRaster {
    val bytesPerRow = bitmap.width / BITS_PER_BYTE
    val packed = ByteArray(bytesPerRow * bitmap.height)
    val row = IntArray(bitmap.width)
    for (y in 0 until bitmap.height) {
      bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
      for (x in 0 until bitmap.width) {
        if (isInk(row[x], x, y)) {
          val index = y * bytesPerRow + x / BITS_PER_BYTE
          packed[index] = (packed[index].toInt() or (0x80 ushr (x % BITS_PER_BYTE))).toByte()
        }
      }
    }
    return MonochromeRaster(bitmap.width, bitmap.height, packed)
  }

  /**
   * A fixed Bayer 4x4 ordered threshold makes anti-aliased edge conversion repeatable. Pure white
   * always stays bit 0; pure black always becomes bit 1. Packing starts at each row's MSB.
   */
  private fun isInk(color: Int, x: Int, y: Int): Boolean {
    val red = Color.red(color)
    val green = Color.green(color)
    val blue = Color.blue(color)
    val luminance = (red * 299 + green * 587 + blue * 114) / 1_000
    val threshold = BAYER_4X4[y and 3][x and 3] * 16 + 8
    return luminance < threshold
  }

  private fun hasPngSignature(bytes: ByteArray): Boolean =
    bytes.size >= PNG_SIGNATURE.size && PNG_SIGNATURE.indices.all { index ->
      bytes[index] == PNG_SIGNATURE[index]
    }

  private data class InspectedLogo(
    val bytes: ByteArray,
    val digest: ByteArray,
    val dimensions: LogoDimensions,
  )

  private data class CachedLogo(
    val version: String,
    val digest: ByteArray,
    val target: LogoDimensions,
    val bitmap: Bitmap,
  )

  private companion object {
    const val BITS_PER_BYTE = 8
    const val BASE64_QUANTUM = 4
    const val MAX_DECODED_LOGO_BYTES = 2_097_152
    const val MAX_SOURCE_LOGO_DIMENSION = 2_048
    const val MAX_SOURCE_LOGO_PIXELS = 1_048_576L
    const val MAX_LOGO_VERSION_CHARS = 256
    const val SHA_256 = "SHA-256"

    val BASE64_PATTERN = Regex("^[A-Za-z0-9+/]*={0,2}$")
    val PNG_SIGNATURE = byteArrayOf(
      0x89.toByte(),
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A,
    )
    val BAYER_4X4 = arrayOf(
      intArrayOf(0, 8, 2, 10),
      intArrayOf(12, 4, 14, 6),
      intArrayOf(3, 11, 1, 9),
      intArrayOf(15, 7, 13, 5),
    )
  }
}
