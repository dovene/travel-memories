/*
 * Content validation: JSON Schema checks (schemas/*.json) plus the cross-field
 * rules a schema cannot express. Every document is validated before it is saved.
 */
import profileSchema from "../../schemas/profile.schema.json" with { type: "json" };
import placesSchema from "../../schemas/places.schema.json" with { type: "json" };
import { validate } from "./schema.js";

export { profileSchema, placesSchema };

export function validateProfile(doc) {
  return validate(profileSchema, doc);
}

export function validatePlacesDocument(doc) {
  const errors = validate(placesSchema, doc);
  if (errors.length) return errors; // structural problems first; the rules below assume the shape

  const err = (path, message) => errors.push({ path, message });
  const placeIds = new Set();
  const slugs = new Set();
  const mediaIds = new Set();

  doc.places.forEach((place, i) => {
    const at = `/places/${i}`;
    if (place.ownerId !== doc.ownerId) err(`${at}/ownerId`, "must match the document owner");
    if (placeIds.has(place.id)) err(`${at}/id`, "must be unique");
    placeIds.add(place.id);
    if (slugs.has(place.slug)) err(`${at}/slug`, "must be unique");
    slugs.add(place.slug);

    const positions = place.media.map((m) => m.position).sort((a, b) => a - b);
    if (positions.some((p, k) => p !== k)) err(`${at}/media`, "positions must run from 0 to n-1 without gaps");

    place.media.forEach((m, k) => {
      // Media ids are unique per owner so /media/:mediaId can resolve them.
      if (mediaIds.has(m.id)) err(`${at}/media/${k}/id`, "must be unique");
      mediaIds.add(m.id);
      if (m.type === "image" && !m.contentType.startsWith("image/")) err(`${at}/media/${k}/contentType`, "does not match type image");
      if (m.type === "video" && !m.contentType.startsWith("video/")) err(`${at}/media/${k}/contentType`, "does not match type video");
    });

    if (place.media.length === 0 && place.coverMediaId !== null) err(`${at}/coverMediaId`, "must be null when there is no media");
    if (place.media.length > 0 && !place.media.some((m) => m.id === place.coverMediaId))
      err(`${at}/coverMediaId`, "must reference an existing media item");
  });

  return errors;
}

/*
 * Fields an administrator may send when creating or updating a place.
 * Everything else (id, ownerId, version, media, timestamps) is controlled by the server;
 * sending it is rejected, so the browser can never set ownership.
 */
const placeInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { $ref: "#/$defs/localizedName" },
    description: { $ref: "#/$defs/localizedText" },
    city: placesSchema.$defs.place.properties.city,
    country: { $ref: "#/$defs/localizedName" },
    countryCode: placesSchema.$defs.place.properties.countryCode,
    visitedAt: placesSchema.$defs.place.properties.visitedAt,
    slug: placesSchema.$defs.place.properties.slug,
    featured: placesSchema.$defs.place.properties.featured,
  },
  $defs: placesSchema.$defs,
};

const REQUIRED_ON_CREATE = ["name", "city", "country", "countryCode"];

export function validatePlaceInput(input, { partial = false } = {}) {
  const errors = validate(placeInputSchema, input);
  if (!partial && typeof input === "object" && input) {
    for (const key of REQUIRED_ON_CREATE) if (!(key in input)) errors.push({ path: `/${key}`, message: "is required" });
  }
  return errors;
}
