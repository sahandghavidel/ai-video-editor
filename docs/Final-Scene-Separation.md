# Final scene separation

Final separation uses the caption-derived `finalSegmentCuts` as the single cut
map for both the Final Video and its rendered HyperFrames video.

When a source scene has `field_7368`, the HyperFrames render is first retimed to
the complete Final Video duration and matched to its frame rate and dimensions.
The aligned render is then cut at the same boundaries as the Final Video. Each
uploaded segment is saved to `field_7368` on its corresponding scene.

Separated Final rows clear inherited `field_7365`, `field_7367`, and
`field_7368` values before generated HyperFrames segment URLs are assigned.
Original-source separation keeps its existing behavior.
