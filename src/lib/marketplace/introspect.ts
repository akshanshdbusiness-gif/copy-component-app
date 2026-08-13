import type { AuthoringClient } from "./authoring";

/**
 * Ask the Authoring endpoint what it actually accepts.
 *
 * Three separate assumptions about this schema have now been wrong, and each
 * one cost a deploy to discover. Introspection answers all of them at once and
 * turns "didn't work" into a specific field name.
 */

interface TypeRef {
  name?: string | null;
  kind?: string | null;
  ofType?: TypeRef | null;
}

interface InputField {
  name: string;
  type?: TypeRef | null;
}

interface FieldWithArgs {
  name: string;
  args?: Array<{ name: string; type?: TypeRef | null }> | null;
}

const TYPE_REF = `
  name
  kind
  ofType { name kind ofType { name kind ofType { name kind } } }
`;

/** Unwrap NON_NULL / LIST wrappers down to the named type. */
function typeName(type: TypeRef | null | undefined): string {
  let current: TypeRef | null | undefined = type;
  const wrappers: string[] = [];
  while (current) {
    if (current.name) {
      return wrappers.length > 0 ? `${current.name}${wrappers.join("")}` : current.name;
    }
    if (current.kind === "NON_NULL") wrappers.push("!");
    if (current.kind === "LIST") wrappers.push("[]");
    current = current.ofType;
  }
  return "?";
}

/** The mutations this app depends on, plus anything that looks related. */
const OF_INTEREST = /^(copy|create|update|add|move|delete)?item/i;

export async function runSchemaCheck(authoring: AuthoringClient): Promise<string> {
  const lines: string[] = [];
  const note = (text = "") => lines.push(text);

  let itemQueryInput: { inputFields?: InputField[] | null } | null = null;
  let mutationFields: FieldWithArgs[] = [];

  try {
    const data = await authoring.graphql<{
      itemQueryInput: { inputFields?: InputField[] | null } | null;
      schema: { mutationType?: { fields?: FieldWithArgs[] | null } | null } | null;
    }>(
      `query SchemaCheck {
        itemQueryInput: __type(name: "ItemQueryInput") {
          inputFields { name type { ${TYPE_REF} } }
        }
        schema: __schema {
          mutationType { fields { name args { name type { ${TYPE_REF} } } } }
        }
      }`,
      {},
    );
    itemQueryInput = data.itemQueryInput;
    mutationFields = data.schema?.mutationType?.fields ?? [];
  } catch (error) {
    return [
      "Schema check failed — introspection may be disabled on this endpoint.",
      "",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }

  note("=== ItemQueryInput (the `where:` argument) ===");
  if (!itemQueryInput?.inputFields?.length) {
    note("  No type named ItemQueryInput — the `where:` argument uses a different type.");
  } else {
    for (const field of itemQueryInput.inputFields) {
      note(`  ${field.name}: ${typeName(field.type)}`);
    }
  }

  note();
  note("=== Item-related mutations ===");
  const relevant = mutationFields.filter((field) => OF_INTEREST.test(field.name));
  if (relevant.length === 0) {
    note("  None matched. All mutation names:");
    note(`  ${mutationFields.map((f) => f.name).join(", ") || "(none)"}`);
  } else {
    for (const field of relevant) {
      const args = (field.args ?? [])
        .map((arg) => `${arg.name}: ${typeName(arg.type)}`)
        .join(", ");
      note(`  ${field.name}(${args})`);
    }
  }

  // Second pass: the input object behind each mutation the app calls.
  const inputTypeNames = new Set<string>();
  for (const field of relevant) {
    if (!/^(copyItem|createItem|updateItem)$/i.test(field.name)) continue;
    for (const arg of field.args ?? []) {
      const name = typeName(arg.type).replace(/[[\]!]/g, "");
      if (name && name !== "?") inputTypeNames.add(name);
    }
  }

  for (const inputName of inputTypeNames) {
    note();
    note(`=== ${inputName} ===`);
    try {
      const data = await authoring.graphql<{
        type: { inputFields?: InputField[] | null } | null;
      }>(
        `query InputType($name: String!) {
          type: __type(name: $name) { inputFields { name type { ${TYPE_REF} } } }
        }`,
        { name: inputName },
      );
      const fields = data.type?.inputFields ?? [];
      if (fields.length === 0) note("  (no input fields reported)");
      for (const field of fields) note(`  ${field.name}: ${typeName(field.type)}`);
    } catch (error) {
      note(`  Could not read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return lines.join("\n");
}
