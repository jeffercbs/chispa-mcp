export function defineTool(tool) {
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name))
        throw new Error(`Nombre de herramienta no válido: ${tool.name}`);
    if (tool.level !== "none" && !("classroom_id" in tool.input.shape))
        throw new Error(`${tool.name} necesita classroom_id.`);
    return tool;
}
