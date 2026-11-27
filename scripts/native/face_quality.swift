// face_quality — Apple Vision face capture quality + landmarks for kinetype covers.
// For every NNNNNN.jpg in <frames-dir> (sorted), prints one JSON line:
//   {"i":<index>,"faces":[{"x":cx,"y":cy,"w":w,"h":h,"q":quality,"eyes":open,"mouth":open,"yaw":yaw}]}
// x/y/w/h normalised (top-left origin); q = VNFaceCaptureQuality (0..1, sharp,
// well lit, frontal); eyes = mean eye opening (height/width); mouth = inner-lip
// gap / face height. First-party OS framework only; offline.
// Usage: face_quality <frames-dir>
import Foundation
import Vision
import ImageIO

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: face_quality <frames-dir>\n", stderr); exit(2) }
let dir = URL(fileURLWithPath: args[1])
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()

func opening(_ r: VNFaceLandmarkRegion2D?) -> Double {
  guard let r = r, r.pointCount >= 4 else { return -1 }
  let p = r.normalizedPoints
  let xs = p.map { Double($0.x) }, ys = p.map { Double($0.y) }
  let w = xs.max()! - xs.min()!
  return w > 0 ? (ys.max()! - ys.min()!) / w : -1
}

for (i, name) in files.enumerated() {
  guard let src = CGImageSourceCreateWithURL(dir.appendingPathComponent(name) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("{\"i\":\(i),\"faces\":[]}"); continue }
  let lm = VNDetectFaceLandmarksRequest()
  let q = VNDetectFaceCaptureQualityRequest()
  let h = VNImageRequestHandler(cgImage: img, options: [:])
  try? h.perform([lm, q])
  let quals = q.results ?? []
  var faces: [String] = []
  for f in lm.results ?? [] {
    let b = f.boundingBox
    // match the capture-quality observation with the nearest box centre
    let best = quals.min(by: { abs($0.boundingBox.midX - b.midX) + abs($0.boundingBox.midY - b.midY) < abs($1.boundingBox.midX - b.midX) + abs($1.boundingBox.midY - b.midY) })
    let quality = Double(best?.faceCaptureQuality ?? -1)
    let le = opening(f.landmarks?.leftEye), re = opening(f.landmarks?.rightEye)
    let eyes = le >= 0 && re >= 0 ? (le + re) / 2 : max(le, re)
    // the MORE closed eye decides: one half-shut eye ruins a cover even when the mean looks fine
    let eyeMin = le >= 0 && re >= 0 ? min(le, re) : eyes
    var mouth = 0.0
    if let lips = f.landmarks?.innerLips, lips.pointCount >= 4 {
      let ys = lips.normalizedPoints.map { Double($0.y) }
      mouth = ys.max()! - ys.min()!
    }
    // head pose: prefer the quality observation's estimate (landmarks may omit it)
    let yaw = Double(truncating: best?.yaw ?? f.yaw ?? 0)
    let pitch = Double(truncating: best?.pitch ?? f.pitch ?? 0)
    // gaze: pupil offset from the eye centre, in eye widths (0 = looking straight)
    func gaze(_ eye: VNFaceLandmarkRegion2D?, _ pupil: VNFaceLandmarkRegion2D?) -> Double {
      guard let e = eye, let pu = pupil, e.pointCount >= 4, pu.pointCount >= 1 else { return -1 }
      let xs = e.normalizedPoints.map { Double($0.x) }, ys = e.normalizedPoints.map { Double($0.y) }
      let w = xs.max()! - xs.min()!
      guard w > 0 else { return -1 }
      let cx = (xs.max()! + xs.min()!) / 2, cy = (ys.max()! + ys.min()!) / 2
      let p = pu.normalizedPoints[0]
      return hypot(Double(p.x) - cx, Double(p.y) - cy) / w
    }
    let gl = gaze(f.landmarks?.leftEye, f.landmarks?.leftPupil), gr = gaze(f.landmarks?.rightEye, f.landmarks?.rightPupil)
    let gz = gl >= 0 && gr >= 0 ? (gl + gr) / 2 : max(gl, gr)
    faces.append(String(format: "{\"x\":%.4f,\"y\":%.4f,\"w\":%.4f,\"h\":%.4f,\"q\":%.4f,\"eyes\":%.4f,\"mouth\":%.4f,\"yaw\":%.4f,\"pitch\":%.4f,\"gaze\":%.4f,\"eyeMin\":%.4f}", Double(b.midX), 1.0 - Double(b.midY), Double(b.width), Double(b.height), quality, eyes, mouth, yaw, pitch, gz, eyeMin))
  }
  print("{\"i\":\(i),\"faces\":[\(faces.joined(separator: ","))]}")
}
