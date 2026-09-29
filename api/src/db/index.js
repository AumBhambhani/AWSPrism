import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? { connectionString }
    : undefined
);

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export const toCamel = (row) => {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    result[camelKey] = value;
  }
  return result;
};

export const mapRows = (result) => result.rows.map(toCamel);

export const mapRow = (result) => (result.rows[0] ? toCamel(result.rows[0]) : null);

export const buildUpdate = (data, startIndex = 1) => {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (keys.length === 0) return null;

  const set = keys.map((key, index) => `${key} = $${startIndex + index}`).join(", ");
  const values = keys.map((key) => data[key]);

  return { set, values, keys };
};
