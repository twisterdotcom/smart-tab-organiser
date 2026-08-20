#!/usr/bin/env swift

import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("store-assets/source/icon-1024.png")
let outputDirectory = root.appendingPathComponent("store-assets/promotional")

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(
        calibratedRed: red / 255,
        green: green / 255,
        blue: blue / 255,
        alpha: alpha
    )
}

func fillRoundedRect(_ rect: NSRect, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func drawTabCard(in rect: NSRect, accent: NSColor) {
    fillRoundedRect(rect, radius: rect.height * 0.12, color: color(255, 255, 255, 0.14))

    let dotSize = rect.height * 0.12
    let rowHeight = rect.height * 0.16
    let left = rect.minX + rect.width * 0.09
    let right = rect.maxX - rect.width * 0.09

    for index in 0..<3 {
        let y = rect.maxY - rect.height * 0.24 - CGFloat(index) * rect.height * 0.25
        fillRoundedRect(
            NSRect(x: left, y: y, width: dotSize, height: dotSize),
            radius: dotSize / 2,
            color: index == 0 ? accent : color(255, 255, 255, 0.65)
        )
        fillRoundedRect(
            NSRect(x: left + dotSize * 1.6, y: y, width: right - left - dotSize * 1.6, height: rowHeight * 0.45),
            radius: rowHeight * 0.22,
            color: color(255, 255, 255, index == 0 ? 0.82 : 0.52)
        )
    }
}

func generate(width: Int, height: Int, filename: String, icon: NSImage) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "StoreAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create bitmap"])
    }

    bitmap.size = NSSize(width: width, height: height)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

    let canvas = NSRect(x: 0, y: 0, width: width, height: height)
    let gradient = NSGradient(colors: [color(42, 24, 112), color(104, 52, 230), color(30, 135, 229)])!
    gradient.draw(in: canvas, angle: -18)

    color(255, 255, 255, 0.07).setFill()
    NSBezierPath(ovalIn: NSRect(x: CGFloat(width) * 0.58, y: CGFloat(height) * 0.40, width: CGFloat(height) * 0.92, height: CGFloat(height) * 0.92)).fill()

    let margin = CGFloat(height) * 0.13
    let cardWidth = min(CGFloat(width) * 0.43, CGFloat(height) * 1.10)
    let cardHeight = CGFloat(height) * 0.58
    drawTabCard(
        in: NSRect(x: margin, y: (CGFloat(height) - cardHeight) / 2, width: cardWidth, height: cardHeight),
        accent: color(255, 204, 78)
    )

    let iconCardSize = CGFloat(height) * 0.70
    let iconCard = NSRect(
        x: CGFloat(width) - margin - iconCardSize,
        y: (CGFloat(height) - iconCardSize) / 2,
        width: iconCardSize,
        height: iconCardSize
    )
    fillRoundedRect(iconCard, radius: iconCardSize * 0.20, color: color(255, 255, 255, 0.96))

    let iconInset = iconCardSize * 0.09
    icon.draw(
        in: iconCard.insetBy(dx: iconInset, dy: iconInset),
        from: NSRect(origin: .zero, size: icon.size),
        operation: .sourceOver,
        fraction: 1
    )

    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "StoreAssets", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
    }

    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    try png.write(to: outputDirectory.appendingPathComponent(filename))
}

guard let icon = NSImage(contentsOf: sourceURL) else {
    fputs("Could not read \(sourceURL.path)\n", stderr)
    exit(1)
}

try generate(width: 440, height: 280, filename: "small-promo-440x280.png", icon: icon)
try generate(width: 1400, height: 560, filename: "marquee-promo-1400x560.png", icon: icon)
print("Generated Chrome Web Store promotional images.")
