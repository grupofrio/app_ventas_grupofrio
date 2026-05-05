# Android Preview Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar un APK Android de continuidad que actualice encima del APK distribuido a vendedores manteniendo package y firma, subiendo `versionCode` a `2` y dejando el proceso documentado.

**Architecture:** La continuidad operativa se apoya en el árbol nativo Android prebuildado del repo y en un `release` local de Gradle que reutiliza `android/app/debug.keystore`. Esto convive con la documentación existente de EAS, pero queda marcado como excepción temporal para update in-place mientras no exista una migración formal a un keystore release.

**Tech Stack:** Expo SDK 52, React Native 0.76, Android Gradle, Node scripts/docs Markdown.

---

### Task 1: Documentar el flujo temporal de continuidad

**Files:**
- Create: `docs/android-update-continuity.md`
- Modify: `README.md`
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Documentar fuente de verdad del APK instalado**
- [ ] **Step 2: Documentar que la continuidad usa build local `release` con la firma actual**
- [ ] **Step 3: Documentar que esto es una solución temporal y que migrar a release keystore/EAS romperá update in-place sin plan de migración**

### Task 2: Alinear versionado Android a continuidad

**Files:**
- Modify: `app.json`
- Modify: `android/app/build.gradle`

- [ ] **Step 1: Subir `android.versionCode` a `2` en la configuración Expo**
- [ ] **Step 2: Subir `versionCode` a `2` en Gradle manteniendo `versionName 1.3.1`, package y firma**
- [ ] **Step 3: Verificar diff para confirmar que no cambió la firma**

### Task 3: Verificar build release sin Metro

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-android-release.mjs`

- [ ] **Step 1: Exponer un comando reproducible para build local de continuidad**
- [ ] **Step 2: Exponer un comando reproducible para verificar package, versionCode, versionName y firma del APK generado**
- [ ] **Step 3: Ejecutar build y verificación sobre el APK resultante**

### Task 4: Intentar validación de update sobre APK previo

**Files:**
- No code changes required unless automation helper is justified

- [ ] **Step 1: Detectar si `adb` está disponible y si el sandbox permite usarlo**
- [ ] **Step 2: Si es posible, instalar el APK previo y luego el nuevo para verificar update in-place**
- [ ] **Step 3: Si el entorno no lo permite, dejar evidencia de bloqueo y los comandos exactos para correr la validación fuera del sandbox**
