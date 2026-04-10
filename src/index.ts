import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

type ComponentImport = {
  from: string;
  named?: string[];
  default?: string | null;
};

type ComponentProp = {
  type: string;
  required: boolean;
  defaultValue: string | null;
  description: string;
};

type ComponentExample = {
  title: string;
  description: string;
  desktop?: string | null;
  mobile?: string | null;
};

type ComponentIndexEntry = {
  componentName: string;
  packageName: string;
  description?: string;
  imports?: ComponentImport[];
  props: Record<string, ComponentProp>;
  examples?: ComponentExample[];
};

const COMPONENTS_INDEX_DIR = join(process.cwd(), "components-index");

function loadComponentIndex(): ComponentIndexEntry[] {
  const files = readdirSync(COMPONENTS_INDEX_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  return files.map((fileName) => {
    const raw = readFileSync(join(COMPONENTS_INDEX_DIR, fileName), "utf8");
    return JSON.parse(raw) as ComponentIndexEntry;
  });
}

function findComponent(query: string): ComponentIndexEntry | undefined {
  const normalizedQuery = query.trim().toLowerCase();

  return loadComponentIndex().find((component) => {
    return (
      component.packageName.toLowerCase() === normalizedQuery ||
      component.componentName.toLowerCase() === normalizedQuery
    );
  });
}

function formatImports(imports: ComponentImport[] | undefined): string {
  if (!imports || imports.length === 0) {
    return "Import information is not available.";
  }

  return imports
    .map((entry) => {
      const parts: string[] = [];

      if (entry.default) {
        parts.push(entry.default);
      }

      if (entry.named && entry.named.length > 0) {
        parts.push(`{ ${entry.named.join(", ")} }`);
      }

      if (parts.length === 0) {
        return `import "${entry.from}";`;
      }

      return `import ${parts.join(", ")} from "${entry.from}";`;
    })
    .join("\n");
}

function getRequiredProps(component: ComponentIndexEntry): string[] {
  return Object.entries(component.props)
    .filter(([, prop]) => prop.required)
    .map(([propName]) => propName);
}

function scoreExample(example: ComponentExample, task: string): number {
  if (!task.trim()) {
    return 0;
  }

  const haystack = [example.title, example.description, example.desktop, example.mobile]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return task
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function pickExample(
  component: ComponentIndexEntry,
  platform: "desktop" | "mobile",
  task?: string,
  exampleTitle?: string
): ComponentExample | undefined {
  const examples = component.examples ?? [];

  if (examples.length === 0) {
    return undefined;
  }

  if (exampleTitle) {
    const normalizedTitle = exampleTitle.trim().toLowerCase();
    const exactMatch = examples.find((example) => example.title.trim().toLowerCase() === normalizedTitle);

    if (exactMatch) {
      return exactMatch;
    }
  }

  const examplesWithCode = examples.filter((example) => {
    const code = platform === "mobile" ? example.mobile : example.desktop;
    return Boolean(code);
  });

  const pool = examplesWithCode.length > 0 ? examplesWithCode : examples;

  if (!task?.trim()) {
    return pool[0];
  }

  return [...pool].sort((left, right) => scoreExample(right, task) - scoreExample(left, task))[0];
}

function getExampleCode(example: ComponentExample, platform: "desktop" | "mobile"): string | null {
  const preferred = platform === "mobile" ? example.mobile : example.desktop;
  const fallback = platform === "mobile" ? example.desktop : example.mobile;

  return preferred ?? fallback ?? null;
}

const server = new McpServer({
  name: "core-components-mcp",
  version: "0.1.0"
});

server.registerTool(
  "list_components",
  {
    description: "Returns the list of available components from the local JSON index."
  },
  async () => {
    const components = loadComponentIndex();
    const items = components.map((component) => {
      const propsCount = Object.keys(component.props).length;
      return `- ${component.componentName} (${component.packageName}) - ${propsCount} props`;
    });

    return {
      content: [
        {
          type: "text",
          text: [
            `Found ${components.length} components in the local index.`,
            "",
            ...items
          ].join("\n")
        }
      ]
    };
  }
);

server.registerTool(
  "get_component",
  {
    description: "Returns component details by package name or component name.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Package name or component name, for example 'accordion' or 'Accordion'")
    }
  },
  async ({ query }) => {
    const component = findComponent(query);

    if (!component) {
      const available = loadComponentIndex()
        .slice(0, 10)
        .map((entry) => `${entry.componentName} (${entry.packageName})`)
        .join(", ");

      return {
        content: [
          {
            type: "text",
            text: `Component "${query}" was not found. Examples: ${available}.`
          }
        ],
        isError: true
      };
    }

    const props = Object.entries(component.props).map(([propName, prop]) => {
      const required = prop.required ? "required" : "optional";
      const defaultValue = prop.defaultValue === null ? "null" : prop.defaultValue;
      const description = prop.description || "No description";

      return `- ${propName}: type=${prop.type}, ${required}, default=${defaultValue}, description=${description}`;
    });

    return {
      content: [
        {
          type: "text",
          text: [
            `Component: ${component.componentName}`,
            `Package: ${component.packageName}`,
            `Props count: ${Object.keys(component.props).length}`,
            "",
            "Props:",
            ...props
          ].join("\n")
        }
      ]
    };
  }
);

server.registerTool(
  "generate_component_usage",
  {
    description: "Assists with writing component usage code based on local snippets, props and import metadata.",
    inputSchema: {
      component: z
        .string()
        .min(1)
        .describe("Package name or component name, for example 'accordion' or 'Accordion'"),
      task: z
        .string()
        .optional()
        .describe("Optional description of the usage scenario to help pick the best snippet"),
      platform: z
        .enum(["desktop", "mobile"])
        .optional()
        .describe("Preferred platform snippet. Defaults to desktop."),
      exampleTitle: z
        .string()
        .optional()
        .describe("Optional exact example title to force a specific snippet")
    }
  },
  async ({ component, task, platform = "desktop", exampleTitle }) => {
    const entry = findComponent(component);

    if (!entry) {
      const available = loadComponentIndex()
        .slice(0, 10)
        .map((item) => `${item.componentName} (${item.packageName})`)
        .join(", ");

      return {
        content: [
          {
            type: "text",
            text: `Component "${component}" was not found. Examples: ${available}.`
          }
        ],
        isError: true
      };
    }

    const example = pickExample(entry, platform, task, exampleTitle);
    const code = example ? getExampleCode(example, platform) : null;
    const requiredProps = getRequiredProps(entry);
    const importantProps = Object.entries(entry.props)
      .filter(([, prop]) => prop.required || /controlled|состояние|обработчик|значение|header|children/i.test(prop.description))
      .slice(0, 8)
      .map(([propName, prop]) => `- ${propName}: ${prop.description || "No description"}`);

    if (!example || !code) {
      return {
        content: [
          {
            type: "text",
            text: [
              `Component: ${entry.componentName}`,
              `Package: ${entry.packageName}`,
              entry.description ? `Description: ${entry.description}` : null,
              "",
              "No code examples are available for this component yet.",
              "",
              "Imports:",
              formatImports(entry.imports),
              "",
              `Required props: ${requiredProps.length > 0 ? requiredProps.join(", ") : "none"}`
            ]
              .filter(Boolean)
              .join("\n")
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: [
            `Component: ${entry.componentName}`,
            `Package: ${entry.packageName}`,
            entry.description ? `Description: ${entry.description}` : null,
            task ? `Task: ${task}` : null,
            `Selected example: ${example.title}`,
            example.description ? `Example description: ${example.description}` : null,
            "",
            "Imports:",
            formatImports(entry.imports),
            "",
            `Required props: ${requiredProps.length > 0 ? requiredProps.join(", ") : "none"}`,
            importantProps.length > 0 ? "" : null,
            importantProps.length > 0 ? "Important props:" : null,
            ...(importantProps.length > 0 ? importantProps : []),
            "",
            `Suggested ${platform} snippet:`,
            "```tsx",
            code,
            "```"
          ]
            .filter(Boolean)
            .join("\n")
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
