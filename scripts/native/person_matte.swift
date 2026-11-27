// person_matte — Apple Vision person segmentation for kinetype.
// For every NNNNNN.jpg in <frames-dir> writes mNNNNNN.png: an RGBA image whose
// ALPHA is the person matte (RGB white), same size as the frame. First-party OS
// framework only; runs offline. Usage: person_matte <frames-dir> [accurate|balanced|fast]
import Foundation
import Vision
import CoreImage
import ImageIO

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: person_matte <frames-dir> [accurate|balanced|fast]\n", stderr); exit(2) }
let dir = URL(fileURLWithPath: args[1])
let quality: VNGeneratePersonSegmentationRequest.QualityLevel = {
  switch args.count > 2 ? args[2] : "accurate" { case "fast": return .fast; case "balanced": return .balanced; default: return .accurate }
}()
let ctx = CIContext(options: [.useSoftwareRenderer: false])
let fm = FileManager.default
let files = try fm.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()
var done = 0
for name in files {
  let out = dir.appendingPathComponent("m" + name.replacingOccurrences(of: ".jpg", with: ".png"))
  if fm.fileExists(atPath: out.path) { done += 1; continue }
  guard let src = CGImageSourceCreateWithURL(dir.appendingPathComponent(name) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fputs("skip \(name)\n", stderr); continue }
  let req = VNGeneratePersonSegmentationRequest()
  req.qualityLevel = quality
  req.outputPixelFormat = kCVPixelFormatType_OneComponent8
  try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  guard let mask = req.results?.first?.pixelBuffer else { fputs("no mask \(name)\n", stderr); continue }
  var m = CIImage(cvPixelBuffer: mask)
  // scale matte to the frame size
  m = m.transformed(by: CGAffineTransform(scaleX: CGFloat(img.width) / m.extent.width, y: CGFloat(img.height) / m.extent.height))
  let alpha = m.applyingFilter("CIMaskToAlpha").cropped(to: CGRect(x: 0, y: 0, width: img.width, height: img.height))
  try ctx.writePNGRepresentation(of: alpha, to: out, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  done += 1
  if done % 200 == 0 { print("\(done)/\(files.count)"); fflush(stdout) }
}
print("done \(done)/\(files.count)")
