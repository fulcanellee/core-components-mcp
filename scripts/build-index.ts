import 'dotenv/config';
import { withCustomConfig, type ParserOptions } from 'react-docgen-typescript';
import { globSync } from 'glob';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CORE_COMPONENTS_PATH = process.env.CORE_COMPONENTS_PATH;

if (!CORE_COMPONENTS_PATH) {
  console.error('❌ CORE_COMPONENTS_PATH not set in .env');
  process.exit(1);
}

const TS_CONFIG_PATH = resolve(CORE_COMPONENTS_PATH, 'tsconfig.react-docgen-typescript.json');

interface Example {
  title: string;
  description: string;
  desktop: string | null;
  mobile: string | null;
}

interface ImportInfo {
  from: string;
  named: string[];
}

interface SerializedPropType {
  type: string;
  typeName: string | null;
  rawType: string | null;
  enumValues: string[];
}

/**
 * Извлекает название пакета из пути файла.
 */
function extractPackageName(filePath: string): string {
  const match = filePath.match(/packages\/([^/]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Формирует название компонента из названия пакета.
 */
function extractComponentName(filePath: string): string {
  const pkg = extractPackageName(filePath);
  return pkg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * Проверяет, содержит ли файл интерфейс с суффиксом Props.
 */
function fileHasPropsInterface(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  return /export\s+(interface|type)\s+\w+Props/.test(content);
}

/**
 * Получает реальное имя файла из файловой системы.
 * На macOS с case-insensitive FS glob может вернуть 'Component.tsx'
 * для файла 'component.tsx'.
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
 */
function isComponentDeprecated(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const jsdocBlock = /\/\*\*([\s\S]*?)\*\/\s*export/.exec(content);
  if (jsdocBlock && jsdocBlock[1].includes('@deprecated')) {
    return true;
  }
  return false;
}

/**
 * Определяет, является ли пропс унаследованным из внешних типов.
 */
function isInheritedFromExternalTypes(prop: any): boolean {
  const parentFile = prop.parent?.fileName;
  if (!parentFile) return false;
  if (parentFile.includes('node_modules/@types/react')) return true;
  if (parentFile.includes('node_modules/@types/react-dom')) return true;
  return false;
}

function stripUndefinedFromType(rawType: string | undefined): string | null {
  if (!rawType) return null;

  const normalized = rawType
    .replace(/\s*\|\s*undefined\b/g, '')
    .replace(/\bundefined\s*\|\s*/g, '')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function extractEnumValues(typeValue: unknown): string[] {
  if (!Array.isArray(typeValue)) return [];

  return typeValue
    .map((entry: any) => entry?.value)
    .filter((value: unknown): value is string => typeof value === 'string' && value !== 'undefined');
}

function serializePropType(prop: any): SerializedPropType {
  const typeName = typeof prop.type?.name === 'string' ? prop.type.name : null;
  const rawType = stripUndefinedFromType(prop.type?.raw);
  const enumValues = extractEnumValues(prop.type?.value);

  const fallbackEnumType = enumValues.length > 0 ? enumValues.join(' | ') : null;
  const resolvedType =
    rawType ||
    (typeName && typeName !== 'enum' ? typeName : null) ||
    fallbackEnumType ||
    'unknown';

  return {
    type: resolvedType,
    typeName,
    rawType,
    enumValues,
  };
}

/**
 * Заменяет группы по 4 пробела в начале строки на 1 пробел.
 */
function normalizeIndent(code: string): string {
  return code
    .split('\n')
    .map(line => line.replace(/^(    )+/g, m => ''.repeat(m.length / 4)))
    .join('\n')
    .trim();
}

/**
 * Парсит MDX-файл и извлекает примеры кода.
 * Структура MDX: ## Заголовок \n\n Описание \n\n ```jsx live ...```
 * Описание берётся только из текста непосредственно перед текущим блоком кода.
 */
function parseMdxExamples(filePath: string): Example[] {
  const content = readFileSync(filePath, 'utf-8');
  const examples: Example[] = [];

  const codeBlockRegex = /```jsx\s+live[^\n]*\n([\s\S]*?)```/g;

  // Находим все заголовки ## и их позиции
  const headingRegex = /^## (.+)$/gm;
  const headings: { title: string; position: number }[] = [];
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingRegex.exec(content)) !== null) {
    headings.push({ title: headingMatch[1].trim(), position: headingMatch.index });
  }

  // Отслеживаем конец предыдущего блока кода (или начало файла)
  let prevBlockEnd = 0;

  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
    const code = codeMatch[1].trim();
    const codePosition = codeMatch.index;

    // Находим заголовок, к которому относится этот блок кода
    let currentTitle = 'Untitled';
    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].position < codePosition) {
        currentTitle = headings[i].title;
        break;
      }
    }

    // Описание — текст между концом предыдущего блока (или заголовком) и текущим блоком кода
    const descStart = prevBlockEnd;
    const between = content.substring(descStart, codePosition).trim();

    // Убираем строку заголовка из начала, если она попала
    const withoutHeading = between.replace(/^## .+\n*/, '').trim();

    // Описание — последний непустой текстовый блок перед кодом (без ```-блоков)
    let description = '';
    const blocks = withoutHeading.split(/\n{2,}/);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const trimmed = blocks[i].trim();
      if (trimmed.length > 0 && !trimmed.startsWith('```')) {
        description = trimmed;
        break;
      }
    }

    const mobileSplitIndex = code.indexOf('//MOBILE');
    let desktop: string | null = null;
    let mobile: string | null = null;

    if (mobileSplitIndex !== -1) {
      desktop = normalizeIndent(code.substring(0, mobileSplitIndex));
      mobile = normalizeIndent(code.substring(mobileSplitIndex + '//MOBILE'.length));
    } else {
      desktop = normalizeIndent(code);
    }

    examples.push({ title: currentTitle, description, desktop, mobile });

    // Обновляем конец предыдущего блока
    prevBlockEnd = codePosition + codeMatch[0].length;
  }

  return examples;
}

/**
 * Извлекает описание компонента из Component.docs.mdx.
 * Ищет тег <ComponentHeader name='...' children='...' /> и возвращает значение children.
 */
function extractComponentDescription(packageName: string): string {
  const docsPath = resolve(
    CORE_COMPONENTS_PATH,
    'packages',
    packageName,
    'src',
    'docs',
    'Component.docs.mdx',
  );

  if (!existsSync(docsPath)) return '';

  const content = readFileSync(docsPath, 'utf-8');
  const componentHeaderMatch = /<ComponentHeader\s+[^>]*children=['"]([^'"]*)['"][^>]*\s*\/>/.exec(content);
  
  return componentHeaderMatch ? componentHeaderMatch[1] : '';
}

/**
 * Извлекает информацию об импортах из development.mdx.
 * Парсит секцию "## Подключение" и извлекает import выражения.
 */
function extractComponentImports(packageName: string): ImportInfo[] {
  const devPath = resolve(
    CORE_COMPONENTS_PATH,
    'packages',
    packageName,
    'src',
    'docs',
    'development.mdx',
  );

  if (!existsSync(devPath)) return [];

  const content = readFileSync(devPath, 'utf-8');
  
  // Находим секцию "## Подключение" и извлекаем блок кода
  const connectionSectionMatch = /## Подключение\s*\n+```jsx\s*\n([\s\S]*?)```/.exec(content);
  if (!connectionSectionMatch) return [];
  
  const importBlock = connectionSectionMatch[1];
  
  // Извлекаем все import выражения
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  const importsMap = new Map<string, Set<string>>();
  
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(importBlock)) !== null) {
    const namedImports = importMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    const fromPath = importMatch[2];
    
    // Фильтруем только импорты из @alfalab/core-components
    if (!fromPath.startsWith('@alfalab/core-components')) continue;
    
    if (!importsMap.has(fromPath)) {
      importsMap.set(fromPath, new Set());
    }
    namedImports.forEach(name => importsMap.get(fromPath)!.add(name));
  }
  
  // Преобразуем в массив ImportInfo
  const imports: ImportInfo[] = [];
  importsMap.forEach((named, from) => {
    imports.push({
      from,
      named: Array.from(named),
    });
  });
  
  return imports;
}

/**
 * Ищет description.mdx для пакета и извлекает примеры.
 */
function extractExamplesForPackage(packageName: string): Example[] {
  const mdxPath = resolve(
    CORE_COMPONENTS_PATH,
    'packages',
    packageName,
    'src',
    'docs',
    'description.mdx',
  );

  if (!existsSync(mdxPath)) return [];

  return parseMdxExamples(mdxPath);
}

async function main() {
  console.log('🔍 Searching for Component.tsx files...');

  const files = globSync('packages/*/src/Component.tsx', {
    cwd: CORE_COMPONENTS_PATH,
    absolute: true,
  });

  const exactCaseFiles = files.filter(f => getRealFileName(f) === 'Component.tsx');

  console.log(`📦 Found ${exactCaseFiles.length} files`);

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
      const propsKeys = Object.keys(doc.props || {});
      if (propsKeys.length === 0) return false;

      if (isComponentDeprecated(doc.filePath)) return false;

      return true;
    })
    .map((doc: any) => {
      const packageName = extractPackageName(doc.filePath);
      const componentName = extractComponentName(doc.filePath);

      const props: Record<string, any> = {};
      Object.entries(doc.props || {}).forEach(([key, prop]: [string, any]) => {
        if (isInheritedFromExternalTypes(prop)) return;

        const serializedType = serializePropType(prop);

        props[key] = {
          ...serializedType,
          required: prop.required || false,
          defaultValue: prop.defaultValue?.value || null,
          description: prop.description || '',
        };
      });

      const description = extractComponentDescription(packageName);
      const imports = extractComponentImports(packageName);
      const examples = extractExamplesForPackage(packageName);

      return {
        componentName,
        packageName,
        filePath: doc.filePath,
        description,
        imports,
        props,
        examples,
      };
    });

  const outputDir = resolve(process.cwd(), 'components-index');
  const fs = await import('node:fs/promises');
  await fs.mkdir(outputDir, { recursive: true });

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
            description: comp.description,
            imports: comp.imports,
            props: comp.props,
            examples: comp.examples,
          },
          null,
          2
        )
      );
    })
  );

  const totalExamples = components.reduce((sum, c) => sum + c.examples.length, 0);
  console.log(`💾 Saved ${components.length} components with ${totalExamples} examples to: ${outputDir}/`);
}

main();
