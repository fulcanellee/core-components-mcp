import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

type ComponentProp = {
  type: string;
  required: boolean;
  defaultValue: string | null;
  description: string;
};

type ComponentIndexEntry = {
  componentName: string;
  packageName: string;
  props: Record<string, ComponentProp>;
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

const transport = new StdioServerTransport();
await server.connect(transport);
