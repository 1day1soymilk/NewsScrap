// A throwaway. Deleted in Task 3 once the working path is known.
Deno.serve(async () => {
  const title = 'SK하이닉스 상한가…반도체 무인기 소동'
  const attempts: Record<string, string> = {}

  // Path 1 — the node entry. npm packages sit on disk under Deno, so its
  // fs/promises reads of the wasm and the model may simply work.
  try {
    const { Garu } = await import('npm:garu-ko@0.9.12')
    const g = await Garu.load()
    attempts.node = g.analyze(title).tokens.map((t) => `${t.text}/${t.pos}`).join(' ')
  } catch (e) {
    attempts.node = `FAILED: ${String(e)}`
  }

  // Path 2 — the browser entry with the model supplied as bytes, so only the
  // wasm is left to wasm-bindgen's own fetch.
  try {
    const { Garu } = await import('npm:garu-ko@0.9.12/browser')
    const { readFile } = await import('node:fs/promises')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const modelPath = require.resolve('garu-ko/models/base.gmdl')
    const modelData = (await readFile(modelPath)).buffer
    const g = await Garu.load({ modelData })
    attempts.browser = g.analyze(title).tokens.map((t) => `${t.text}/${t.pos}`).join(' ')
  } catch (e) {
    attempts.browser = `FAILED: ${String(e)}`
  }

  // Path 3 — drive the wasm-bindgen glue directly, supplying both the wasm and
  // the model as bytes. Nothing is left for either entry point to resolve.
  try {
    const glue = await import('npm:garu-ko@0.9.12/pkg/garu_wasm.js')
    const { readFile } = await import('node:fs/promises')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const wasmBytes = await readFile(require.resolve('garu-ko/pkg/garu_wasm_bg.wasm'))
    const modelBytes = await readFile(require.resolve('garu-ko/models/base.gmdl'))
    await glue.default(wasmBytes)
    const instance = new glue.GaruWasm(new Uint8Array(modelBytes), false)
    attempts.glue = JSON.stringify(instance.analyze(title)).slice(0, 300)
  } catch (e) {
    attempts.glue = `FAILED: ${String(e)}`
  }

  return new Response(JSON.stringify(attempts, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
