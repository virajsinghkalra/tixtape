/**
 * Branded IDs stop us passing an event ID where an artist ID is expected.
 * Create them only at boundaries (DB rows, validated API input).
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EventId = Brand<string, "EventId">;
export type VenueId = Brand<string, "VenueId">;
export type ArtistId = Brand<string, "ArtistId">;
export type UserId = Brand<string, "UserId">;
export type PlaylistJobId = Brand<string, "PlaylistJobId">;
export type SpotifyArtistId = Brand<string, "SpotifyArtistId">;
export type SpotifyTrackId = Brand<string, "SpotifyTrackId">;
export type SpotifyPlaylistId = Brand<string, "SpotifyPlaylistId">;

export const asEventId = (s: string) => s as EventId;
export const asVenueId = (s: string) => s as VenueId;
export const asArtistId = (s: string) => s as ArtistId;
export const asUserId = (s: string) => s as UserId;
export const asPlaylistJobId = (s: string) => s as PlaylistJobId;
export const asSpotifyArtistId = (s: string) => s as SpotifyArtistId;
export const asSpotifyTrackId = (s: string) => s as SpotifyTrackId;
export const asSpotifyPlaylistId = (s: string) => s as SpotifyPlaylistId;
