// relight — Apple Vision + Core Image studio relight for kinetype.
//
//   relight analyze <frames-dir>
//     For every *.jpg prints one JSON line with the frame's mean luma, and the
//     largest face's box (normalised, bottom-left origin) + mean RGB/luma.
//
//   relight run <W> <H> <params.json>
//     Streams raw BGRA frames (W×H) stdin → stdout. Per frame: a person matte
//     (VNGeneratePersonSegmentationRequest, sequence handler → temporally
//     stable), feathered and EMA-smoothed; the face box (EMA-smoothed); then a
//     soft key light on the person, the room falling off, a gentle cast fix.
//     Parameters are constants for the whole video (from `analyze`), so nothing
//     breathes. First-party OS frameworks only; runs offline.
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO

let args = CommandLine.arguments
guard args.count >= 3 else { fputs("usage: relight analyze <dir> | relight run <W> <H> <params.json>\n", stderr); exit(2) }
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.linearSRGB)!, .outputColorSpace: srgb, .cacheIntermediates: false])

func luma(_ r: Double, _ g: Double, _ b: Double) -> Double { 0.2126 * r + 0.7152 * g + 0.0722 * b }
func average(_ img: CIImage, _ rect: CGRect) -> (Double, Double, Double) {
  let f = CIFilter.areaAverage(); f.inputImage = img; f.extent = rect
  var px = [Float](repeating: 0, count: 4)
  ctx.render(f.outputImage!, toBitmap: &px, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: srgb)
  return (Double(px[0]), Double(px[1]), Double(px[2]))
}

if args[1] == "analyze" {
  let dir = URL(fileURLWithPath: args[2])
  let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()
  for name in files {
    guard let img = CIImage(contentsOf: dir.appendingPathComponent(name)) else { continue }
    let e = img.extent
    let (sr, sg, sb) = average(img, e)
    let req = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(ciImage: img, options: [:]).perform([req])
    var face = "null"
    if let f = (req.results ?? []).max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
      let b = f.boundingBox
      // the face's skin: the central part of the box (skip hair/background at the edges)
      let r = CGRect(x: e.minX + (b.minX + b.width * 0.25) * e.width, y: e.minY + (b.minY + b.height * 0.2) * e.height, width: b.width * 0.5 * e.width, height: b.height * 0.55 * e.height)
      let (fr, fg, fb) = average(img, r)
      face = String(format: "{\"x\":%.4f,\"y\":%.4f,\"w\":%.4f,\"h\":%.4f,\"r\":%.4f,\"g\":%.4f,\"b\":%.4f,\"luma\":%.4f}", b.midX, b.midY, b.width, b.height, fr, fg, fb, luma(fr, fg, fb))
    }
    print(String(format: "{\"file\":\"%@\",\"luma\":%.4f,\"face\":%@}", name, luma(sr, sg, sb), face))
  }
  exit(0)
}

// ── run ──────────────────────────────────────────────────────────────────
guard args[1] == "run", args.count >= 5, let W = Int(args[2]), let H = Int(args[3]) else { fputs("bad args\n", stderr); exit(2) }
let P = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[4]))) as! [String: Any]
func num(_ k: String, _ d: Double) -> Double { (P[k] as? NSNumber)?.doubleValue ?? d }
let subjectEV = num("subjectEV", 0), keyEV = num("keyEV", 0), bgEV = num("bgEV", 0)
let bgSat = num("bgSaturation", 1), clarity = num("clarity", 0), warmK = num("warmth", 0)
let gainR = num("gainR", 1), gainG = num("gainG", 1), gainB = num("gainB", 1)
let feather = num("feather", 0.006) * Double(W)
let neutral = subjectEV == 0 && keyEV == 0 && bgEV == 0 && bgSat == 1 && clarity == 0 && warmK == 0 && gainR == 1 && gainG == 1 && gainB == 1

let frameBytes = W * H * 4
var inBuf = [UInt8](repeating: 0, count: frameBytes)
var outBuf = [UInt8](repeating: 0, count: frameBytes)
let seq = VNSequenceRequestHandler()
let segReq = VNGeneratePersonSegmentationRequest()
segReq.qualityLevel = .balanced
segReq.outputPixelFormat = kCVPixelFormatType_OneComponent8
let faceReq = VNDetectFaceRectanglesRequest()
// smoothed state (materialised every frame — never a growing lazy CI chain)
var maskPrev: CVPixelBuffer? = nil
var fx = 0.5, fy = 0.6, fw = 0.35, faceSeen = false, coverage = 0.0
var frame = 0

func readFull(_ buf: inout [UInt8]) -> Bool {
  var got = 0
  return buf.withUnsafeMutableBytes { p -> Bool in
    while got < frameBytes {
      let n = read(0, p.baseAddress! + got, frameBytes - got)
      if n <= 0 { return false }
      got += n
    }
    return true
  }
}
func writeFull(_ buf: [UInt8]) {
  buf.withUnsafeBytes { p in
    var off = 0
    while off < frameBytes { let n = write(1, p.baseAddress! + off, frameBytes - off); if n <= 0 { exit(1) }; off += n }
  }
}
func exposure(_ i: CIImage, _ ev: Double) -> CIImage { ev == 0 ? i : i.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: ev]) }

while readFull(&inBuf) {
  if neutral { writeFull(inBuf); frame += 1; continue }
  let data = Data(inBuf)
  let src = CIImage(bitmapData: data, bytesPerRow: W * 4, size: CGSize(width: W, height: H), format: .BGRA8, colorSpace: srgb)
  let ext = src.extent
  // person matte, temporally smoothed at the matte's own resolution
  try? seq.perform([segReq, faceReq], on: src)
  var mask: CIImage = CIImage(color: .black).cropped(to: ext)
  if let mb = segReq.results?.first?.pixelBuffer {
    var cur = CIImage(cvPixelBuffer: mb)
    let mw = CVPixelBufferGetWidth(mb), mh = CVPixelBufferGetHeight(mb)
    if let prev = maskPrev, CVPixelBufferGetWidth(prev) == mw {
      cur = CIImage(cvPixelBuffer: prev).applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": cur, "inputTime": 0.65])
    }
    var out: CVPixelBuffer? = nil
    CVPixelBufferCreate(nil, mw, mh, kCVPixelFormatType_OneComponent8, [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &out)
    if let out = out { ctx.render(cur, to: out, bounds: CGRect(x: 0, y: 0, width: mw, height: mh), colorSpace: nil); maskPrev = out; cur = CIImage(cvPixelBuffer: out) }
    let (cv, _, _) = average(cur, cur.extent)
    coverage = coverage * 0.8 + cv * 0.2
    mask = cur.transformed(by: CGAffineTransform(scaleX: ext.width / CGFloat(mw), y: ext.height / CGFloat(mh)))
      .clampedToExtent().applyingGaussianBlur(sigma: feather).cropped(to: ext)
  }
  // face (bottom-left origin, like Core Image): the key light follows it smoothly
  if let f = (faceReq.results ?? []).max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
    let b = f.boundingBox
    let k = faceSeen ? 0.12 : 1.0
    fx += (Double(b.midX) - fx) * k; fy += (Double(b.midY) - fy) * k; fw += (Double(b.width) - fw) * k
    faceSeen = true
  }
  // a frame with no person present: fade the look out (no pumping room)
  let presence = min(1, coverage / 0.05)
  // global cast correction (skin reads as skin, not purple) + gentle warmth
  var base = src.applyingFilter("CIColorMatrix", parameters: [
    "inputRVector": CIVector(x: CGFloat(1 + (gainR - 1) * presence), y: 0, z: 0, w: 0),
    "inputGVector": CIVector(x: 0, y: CGFloat(1 + (gainG - 1) * presence), z: 0, w: 0),
    "inputBVector": CIVector(x: 0, y: 0, z: CGFloat(1 + (gainB - 1) * presence), w: 0)])
  if warmK != 0 { base = base.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: CGFloat(6500 - warmK * presence), y: 0)]) }
  // subject: lift + a soft key from above one side of the face + a touch of clarity
  var subject = exposure(base, subjectEV * presence)
  if clarity > 0 { subject = subject.applyingFilter("CIUnsharpMask", parameters: [kCIInputRadiusKey: Double(W) * 0.028, kCIInputIntensityKey: clarity * presence]).cropped(to: ext) }
  if keyEV > 0 && faceSeen {
    let keyed = exposure(subject, keyEV * presence)
    let c = CIVector(x: CGFloat((fx - fw * 0.28) * Double(ext.width)), y: CGFloat((fy + fw * 0.3) * Double(ext.height)))
    let g = CIFilter.radialGradient()
    g.center = CGPoint(x: c.x, y: c.y); g.radius0 = Float(fw * 0.35 * Double(ext.width)); g.radius1 = Float(fw * 1.7 * Double(ext.width))
    g.color0 = CIColor(red: 1, green: 1, blue: 1); g.color1 = CIColor(red: 0, green: 0, blue: 0)
    subject = keyed.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: subject, kCIInputMaskImageKey: g.outputImage!.cropped(to: ext)])
  }
  // room: falls off a little and loses some colour
  var room = exposure(base, bgEV * presence)
  if bgSat != 1 { room = room.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1 + (bgSat - 1) * presence]) }
  let outImg = subject.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: room, kCIInputMaskImageKey: mask]).cropped(to: ext)
  outBuf.withUnsafeMutableBytes { p in ctx.render(outImg, toBitmap: p.baseAddress!, rowBytes: W * 4, bounds: ext, format: .BGRA8, colorSpace: srgb) }
  writeFull(outBuf)
  frame += 1
  if frame % 150 == 0 { fputs("frame \(frame)\n", stderr) }
}
