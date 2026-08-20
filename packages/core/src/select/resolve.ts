import { SelectorKind } from '../model/enums.js'
import type { Tag, TagId, Track, TrackSelector } from '../model/types.js'

/**
 * Expand a tag to itself plus every descendant, so selecting 'exercise' also selects
 * 'cardio' beneath it. Cycle-safe: a malformed parent chain must not hang the app.
 */
export function descendantTags(roots: readonly TagId[], tags: readonly Tag[]): Set<TagId> {
  const childrenOf = new Map<TagId, TagId[]>()
  for (const tag of tags) {
    if (!tag.parentId) continue
    const siblings = childrenOf.get(tag.parentId) ?? []
    siblings.push(tag.id)
    childrenOf.set(tag.parentId, siblings)
  }

  const seen = new Set<TagId>()
  const stack = [...roots]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return seen
}

/**
 * Resolve a selector against the track list. Pure, and stable under reordering of
 * `tracks` -- output preserves input order so downstream rendering does not jitter.
 */
export function resolve(
  selector: TrackSelector,
  tracks: readonly Track[],
  tags: readonly Tag[] = [],
): Track[] {
  const matched = matchIds(selector, tracks, tags)
  return tracks.filter((t) => matched.has(t.id))
}

function matchIds(
  selector: TrackSelector,
  tracks: readonly Track[],
  tags: readonly Tag[],
): Set<string> {
  switch (selector.t) {
    case SelectorKind.All:
      return new Set(tracks.map((t) => t.id))

    case SelectorKind.Track: {
      const wanted = new Set(selector.ids)
      return new Set(tracks.filter((t) => wanted.has(t.id)).map((t) => t.id))
    }

    case SelectorKind.Tag: {
      const wanted =
        selector.transitive === true ? descendantTags(selector.tags, tags) : new Set(selector.tags)
      return new Set(
        tracks
          .filter((t) =>
            selector.match === 'all'
              ? [...wanted].every((tag) => t.tags.includes(tag))
              : t.tags.some((tag) => wanted.has(tag)),
          )
          .map((t) => t.id),
      )
    }

    case SelectorKind.ValueType: {
      const wanted = new Set<string>(selector.valueTypes)
      return new Set(tracks.filter((t) => wanted.has(t.valueType)).map((t) => t.id))
    }

    case SelectorKind.Union: {
      const out = new Set<string>()
      for (const sub of selector.of) {
        for (const id of matchIds(sub, tracks, tags)) out.add(id)
      }
      return out
    }

    case SelectorKind.Intersect: {
      if (selector.of.length === 0) return new Set()
      const [head, ...rest] = selector.of
      let acc = matchIds(head!, tracks, tags)
      for (const sub of rest) {
        const next = matchIds(sub, tracks, tags)
        acc = new Set([...acc].filter((id) => next.has(id)))
      }
      return acc
    }

    case SelectorKind.Except: {
      const base = matchIds(selector.from, tracks, tags)
      const remove = matchIds(selector.minus, tracks, tags)
      return new Set([...base].filter((id) => !remove.has(id)))
    }

    default: {
      const exhaustive: never = selector
      throw new Error(`unhandled selector kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
