// face_mouths — Apple Vision face landmarks for kinetype's speaker detection.
// For every NNNNNN.jpg in <frames-dir> (sorted), prints one JSON line:
//   {"i":<index>,"faces":[{"x":cx,"y":cy,"w":w,"h":h,"open":mouthOpen}]}
// x/y/w/h are normalised (top-left origin); open = inner-lip gap / face height.
// First-party OS framework only; runs offline. Usage: face_mouths <frames-dir>
import Foundation
import Vision
import ImageIO

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: face_mouths <frames-dir>\n", stderr); exit(2) }
let dir = URL(fileURLWithPath: args[1])
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()
for (i, name) in files.enumerated() {
  guard let src = CGImageSourceCreateWithURL(dir.appendingPathComponent(name) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("{\"i\":\(i),\"faces\":[]}"); continue }
  let req = VNDetectFaceLandmarksRequest()
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  var faces: [String] = []
  for f in req.results ?? [] {
    let b = f.boundingBox // normalised, bottom-left origin
    var open = 0.0
    if let lips = f.landmarks?.innerLips, lips.pointCount >= 4 {
      let ys = lips.normalizedPoints.map { Double($0.y) } // relative to the face box
      open = (ys.max()! - ys.min()!)
    } else if let lips = f.landmarks?.outerLips, lips.pointCount >= 4 {
      let ys = lips.normalizedPoints.map { Double($0.y) }
      open = (ys.max()! - ys.min()!) * 0.5
    }
    let cx = Double(b.midX), cy = 1.0 - Double(b.midY)
    faces.append(String(format: "{\"x\":%.4f,\"y\":%.4f,\"w\":%.4f,\"h\":%.4f,\"open\":%.4f}", cx, cy, Double(b.width), Double(b.height), open))
  }
  print("{\"i\":\(i),\"faces\":[\(faces.joined(separator: ","))]}")
}
