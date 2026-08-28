type HyperFramesHtmlValidationOptions = {
  maxLines?: number;
  require4KCanvas?: boolean;
  expectedDuration?: number;
  minimumDuration?: number;
  durationTolerance?: number;
};

export function validateHyperFramesHtml(
  html: string,
  options: HyperFramesHtmlValidationOptions = {},
): string[] {
  const issues: string[] = [];

  if (!/data-composition-id\s*=\s*["']/i.test(html)) {
    issues.push('missing root data-composition-id');
  }
  if (!/data-start\s*=\s*["']/i.test(html)) {
    issues.push('missing data-start timing attribute');
  }
  const duration = Number(
    html.match(/data-duration\s*=\s*["']([^"']+)["']/i)?.[1],
  );
  if (!/data-duration\s*=\s*["']/i.test(html)) {
    issues.push('missing data-duration timing attribute');
  } else if (!Number.isFinite(duration) || duration <= 0) {
    issues.push('root data-duration must be a positive number');
  } else {
    const tolerance = options.durationTolerance ?? 0.01;
    if (
      Number.isFinite(options.expectedDuration) &&
      Math.abs(duration - Number(options.expectedDuration)) > tolerance
    ) {
      issues.push(
        `root data-duration must match ${Number(options.expectedDuration).toFixed(3)} seconds`,
      );
    }
    if (
      Number.isFinite(options.minimumDuration) &&
      duration + tolerance < Number(options.minimumDuration)
    ) {
      issues.push(
        `root data-duration must be at least ${Number(options.minimumDuration).toFixed(3)} seconds`,
      );
    }
  }
  const width = html.match(/data-width\s*=\s*["']([^"']+)["']/i)?.[1];
  const height = html.match(/data-height\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!width || !height) {
    issues.push('missing fixed data-width/data-height composition size');
  } else if (
    options.require4KCanvas &&
    (Number(width) !== 3840 || Number(height) !== 2160)
  ) {
    issues.push('composition must use the 16:9 landscape 4K size 3840x2160');
  }
  if (!/class\s*=\s*["'][^"']*\bclip\b/i.test(html)) {
    issues.push('missing timed class="clip" elements');
  }
  if (!/data-track-index\s*=\s*["']/i.test(html)) {
    issues.push('missing data-track-index on timed clips');
  }
  if (!/window\.__timelines\s*\[/i.test(html)) {
    issues.push('missing window.__timelines registration');
  }
  if (!/gsap\.timeline\s*\(\s*\{\s*paused\s*:\s*true/i.test(html)) {
    issues.push('missing synchronously-created paused GSAP timeline');
  }
  if (!/<script[^>]+src=["'][^"']*gsap[^"']*["'][^>]*>/i.test(html)) {
    issues.push('missing GSAP script tag before the animation script');
  }
  if (/requestAnimationFrame|performance\.now\s*\(/i.test(html)) {
    issues.push('render-time clock or requestAnimationFrame is not seek-safe');
  }
  if (/\btransition\s*:/i.test(html)) {
    issues.push('CSS transitions are not deterministic for HyperFrames rendering');
  }
  if (options.maxLines && html.split(/\r?\n/).length > options.maxLines) {
    issues.push(
      `composition HTML must be ${options.maxLines} lines or fewer`,
    );
  }

  return issues;
}
