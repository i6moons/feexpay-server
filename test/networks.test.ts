import { describe, expect, it } from 'vitest'
import { NETWORKS, maskPhoneNumber, networksOf, normalizePhoneNumber } from '../src/index.js'

describe('normalizePhoneNumber', () => {
  it.each([
    ['01 97 00 00 00', 'BJ', '2290197000000'],
    ['+229 01 97 00 00 00', 'BJ', '2290197000000'],
    ['00229-01-97-00-00-00', 'BJ', '2290197000000'],
    ['2290197000000', 'BJ', '2290197000000'],
    ['05 07 70 00 00', 'CI', '2250507700000'],
    ['+225 0507700000', 'CI', '2250507700000'],
    ['77 000 00 00', 'SN', '221770000000'],
    ['90 00 00 00', 'TG', '22890000000'],
    ['70 00 00 00', 'BF', '22670000000'],
    ['06 100 0000', 'CG', '242061000000'],
  ] as const)('%s (%s) → %s', (input, country, expected) => {
    expect(normalizePhoneNumber(input, country)).toBe(expected)
  })

  it.each([
    ['97 00 00 00', 'BJ', 'ancien numéro béninois à 8 chiffres'],
    ['02 97 00 00 00', 'BJ', 'les numéros béninois commencent par 01'],
    ['+225 05 07 70 00 00', 'BJ', 'numéro ivoirien pour un réseau béninois'],
    ['01 97 00 00 0a', 'BJ', 'caractère non numérique'],
    ['', 'CI', 'saisie vide'],
    ['77 000 00 0', 'SN', 'trop court'],
  ] as const)('refuse %s (%s) : %s', (input, country, _reason) => {
    expect(normalizePhoneNumber(input, country)).toBeNull()
  })
})

describe('maskPhoneNumber', () => {
  it("ne garde que l'indicatif et les deux derniers chiffres", () => {
    expect(maskPhoneNumber('2290197000005')).toBe('+229 ••••••••05')
    expect(maskPhoneNumber('221770000042')).toBe('+221 •••••••42')
  })
})

describe('NETWORKS', () => {
  it('couvre les 17 réseaux documentés', () => {
    expect(Object.keys(NETWORKS)).toHaveLength(17)
  })

  it('range les réseaux par pays', () => {
    expect(networksOf('BJ').map((n) => n.id)).toEqual(['mtn', 'moov', 'celtiis_bj', 'coris'])
    expect(networksOf('CG')[0]?.currency).toBe('XAF')
  })
})
