import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  htmlLabels: false,
  maxTextSize: 50000,
  maxEdges: 500,
  theme: 'base',
  fontFamily: 'Inter, Segoe UI, sans-serif',
  themeVariables: {
    darkMode: true,
    background: '#141414',
    primaryColor: '#262016',
    primaryTextColor: '#f5f0eb',
    primaryBorderColor: '#ad8855',
    secondaryColor: '#20282b',
    tertiaryColor: '#1a1a1a',
    lineColor: '#c2a278',
    textColor: '#f5f0eb',
  },
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'suppressErrorRendering',
    'htmlLabels',
    'maxTextSize',
    'maxEdges',
    'themeCSS',
    'themeVariables',
    'fontFamily',
  ],
});
let nextDiagram = 0;

export async function renderDiagram(source) {
  const staging = document.createElement('div');
  staging.className = 'markdown-diagram-staging';
  document.body.append(staging);
  try {
    const { svg } = await mermaid.render(`aterm-diagram-${++nextDiagram}`, source, staging);
    const image = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const box = image
      .getAttribute('viewBox')
      ?.split(/[\s,]+/)
      .map(Number);
    // An image keeps diagram CSS and authored content separate from the application DOM.
    return {
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      width: box?.[2],
      height: box?.[3],
    };
  } finally {
    staging.remove();
  }
}
