/**
 * Extrai um valor de um objeto usando um path no formato "data.temperatura"
 * @param obj - Objeto fonte
 * @param path - Path no formato dot notation (ex: "data.temperatura", "sensors.temp.value")
 * @returns O valor encontrado ou undefined se não existir
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object' || !path) {
    return undefined;
  }

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    
    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Define um valor em um objeto usando um path no formato "data.temperatura"
 * @param obj - Objeto alvo
 * @param path - Path no formato dot notation
 * @param value - Valor a ser definido
 * @returns Novo objeto com o valor definido
 */
export function setValueByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown
): T {
  if (!path) return obj;

  const keys = path.split('.');
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    } else {
      current[key] = { ...(current[key] as Record<string, unknown>) };
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result;
}
