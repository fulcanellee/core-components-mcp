import 'dotenv/config';
import { withCustomConfig, type ParserOptions } from 'react-docgen-typescript';
import { globSync } from 'glob';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CORE_COMPONENTS_PATH = process.env.CORE_COMPONENTS_PATH;

if (!CORE_COMPONENTS_PATH) {
  console.error('❌ CORE_COMPONENTS_PATH not set in .env');
  process.exit(1);
}

const TS_CONFIG_PATH = resolve(CORE_COMPONENTS_PATH, 'tsconfig.react-docgen-typescript.json');

/**
 * Извлекает название пакета из пути файла.
 * Пример: packages/button/src/Component.tsx -> button
 */
function extractPackageName(filePath: string): string {
  const match = filePath.match(/packages\/([^/]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Формирует название компонента из названия пакета.
 * Пример: button -> Button, action-button -> ActionButton
 */
function extractComponentName(filePath: string): string {
  const pkg = extractPackageName(filePath);
  return pkg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * Проверяет, содержит ли файл интерфейс с суффиксом Props.
 * Ищет export interface *Props или export type *Props.
 */
function fileHasPropsInterface(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  return /export\s+(interface|type)\s+\w+Props/.test(content);
}

/**
 * Получает реальное имя файла из файловой системы.
 * На macOS с case-insensitive FS glob может вернуть 'Component.tsx'
 * для файла 'component.tsx'. Эта функция читает реальное имя из readdir.
 */
function getRealFileName(filePath: string): string {
  const dir = dirname(filePath);
  const expectedBase = filePath.split('/').pop()!;
  try {
    const entries = readdirSync(dir);
    const match = entries.find(e => e.toLowerCase() === expectedBase.toLowerCase());
    return match || expectedBase;
  } catch {
    return expectedBase;
  }
}

/**
 * Проверяет, что компонент не deprecated.
 * Читает Component.tsx и ищет @deprecated в JSDoc перед объявлением компонента.
 */
function isComponentDeprecated(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  // Ищем @deprecated в блоке JSDoc перед export const/component
  // Паттерн: /** ... @deprecated ... */ export
  const jsdocBlock = /\/\*\*([\s\S]*?)\*\/\s*export/.exec(content);
  if (jsdocBlock && jsdocBlock[1].includes('@deprecated')) {
    return true;
  }
  return false;
}

/**
 * Определяет, является ли пропс унаследованным из внешних типов
 * (@types/react, @types/react-dom и т.д.), а не частью API компонента.
 */
function isInheritedFromExternalTypes(prop: any): boolean {
  const parentFile = prop.parent?.fileName;
  if (!parentFile) return false;

  // node_modules/@types/react, node_modules/@types/react-dom и т.д.
  if (parentFile.includes('node_modules/@types/react')) return true;
  if (parentFile.includes('node_modules/@types/react-dom')) return true;

  return false;
}

async function main() {
  console.log('🔍 Searching for Component.tsx files...');

  const files = globSync('packages/*/src/Component.tsx', {
    cwd: CORE_COMPONENTS_PATH,
    absolute: true,
  });

  // На macOS файловая система case-insensitive, glob находит и component.tsx.
  // Явно фильтруем только файлы с точным именем Component.tsx (с большой буквы).
  const exactCaseFiles = files.filter(f => getRealFileName(f) === 'Component.tsx');

  console.log(`📦 Found ${exactCaseFiles.length} files`);

  // Фильтруем только те файлы, где есть интерфейс *Props
  const filesWithProps = exactCaseFiles.filter(fileHasPropsInterface);
  console.log(`✅ ${filesWithProps.length} files with *Props interface`);

  const parserOptions: ParserOptions = {
    savePropValueAsString: true,
    shouldExtractValuesFromUnion: true,
    shouldExtractLiteralValuesFromEnum: true,
  };

  const parser = withCustomConfig(TS_CONFIG_PATH, parserOptions);
  const docs = parser.parse(filesWithProps);

  const components = docs
    .filter((doc: any) => {
      // Убеждаемся что у компонента есть пропсы
      const propsKeys = Object.keys(doc.props || {});
      if (propsKeys.length === 0) return false;

      // Пропускаем deprecated компоненты — проверяем JSDoc в Component.tsx
      if (isComponentDeprecated(doc.filePath)) return false;

      return true;
    })
    .map((doc: any) => {
      const packageName = extractPackageName(doc.filePath);
      const componentName = extractComponentName(doc.filePath);

      const props: Record<string, any> = {};
      Object.entries(doc.props || {}).forEach(([key, prop]: [string, any]) => {
        // Пропускаем пропсы, унаследованные из @types/react, @types/react-dom
        if (isInheritedFromExternalTypes(prop)) return;

        props[key] = {
          type: prop.type?.name || prop.type?.raw || 'unknown',
          required: prop.required || false,
          defaultValue: prop.defaultValue?.value || null,
          description: prop.description || '',
        };
      });

      return {
        componentName,
        packageName,
        filePath: doc.filePath,
        props,
      };
    });

  // Создаём папку components-index и сохраняем по одному файлу на компонент
  const outputDir = resolve(process.cwd(), 'components-index');
  const fs = await import('node:fs/promises');
  await fs.mkdir(outputDir, { recursive: true });

  // Удаляем старые файлы
  try {
    const existing = await fs.readdir(outputDir);
    await Promise.all(existing.map(f => fs.rm(resolve(outputDir, f))));
  } catch {}

  await Promise.all(
    components.map(async (comp) => {
      const fileName = `${comp.packageName}.json`;
      await fs.writeFile(
        resolve(outputDir, fileName),
        JSON.stringify(
          {
            componentName: comp.componentName,
            packageName: comp.packageName,
            props: comp.props,
          },
          null,
          2
        )
      );
    })
  );

  console.log(`💾 Saved ${components.length} components to: ${outputDir}/`);
}

main();
