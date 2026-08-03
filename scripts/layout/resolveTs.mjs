// src/의 import는 확장자가 없다 — Vite의 번들러 해석에 맞춰 쓰여 있다. Node의
// ESM 해석기는 확장자를 요구하므로, 상대 경로에 한해 .ts / .tsx를 붙여 본다.
//
// 측정 스크립트 하나 때문에 tsx나 vite-node를 의존성에 들이지 않기 위한 것이고,
// 하는 일이 이게 전부다.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '.js']

export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    for (const ext of EXTENSIONS) {
      const url = new URL(specifier + ext, context.parentURL)
      if (existsSync(fileURLToPath(url))) return next(specifier + ext, context)
    }
  }
  return next(specifier, context)
}
