# KaTeX vendor notice

- Version: KaTeX 0.16.22
- Source: npm package `katex@0.16.22`
- Purpose: render LaTeX formulas locally in the evidence review interface without a runtime network dependency.
- Loaded files: `katex.min.css`, `katex.min.js`, and `contrib/auto-render.min.js`.
- Loaded assets: the KaTeX font files under `fonts/`, as referenced by `katex.min.css`.
- License: MIT; the unmodified upstream license is stored in `LICENSE` in this directory.

## Updating

1. Run `npm pack katex@<version>` in a temporary directory.
2. Extract the package archive.
3. Replace this directory's distribution files with the contents of the package's `dist/` directory, including `contrib/` and `fonts/`.
4. Copy the package's original `LICENSE` file into this directory.
5. Update the version and source above, then run the frontend and application test suites.
