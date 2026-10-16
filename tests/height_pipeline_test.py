import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.python-deps'))
sys.path.insert(0, str(ROOT / 'scripts'))

import prepare_data


class BuildingHeightPipelineTests(unittest.TestCase):
    def test_height_tags_are_not_silently_capped(self):
        self.assertEqual(prepare_data.building_height({'height': '452'}), (452.0, 'height-tag'))
        self.assertEqual(prepare_data.building_height({'height': '750 m'}), (750.0, 'height-tag'))

    def test_height_units_convert_to_meters(self):
        height, source = prepare_data.building_height({'height': '40 ft'})
        self.assertEqual(source, 'height-tag')
        self.assertTrue(math.isclose(height, 12.192, rel_tol=0, abs_tol=1e-9))

    def test_levels_over_one_hundred_are_estimated_without_a_cap(self):
        self.assertEqual(prepare_data.building_height({'building:levels': '120'}), (360.0, 'levels-estimate'))
        _, _, provenance = prepare_data.building_height_with_provenance(
            {'building:levels': '201'}, 'way', 99)
        self.assertTrue(provenance['reviewRequired'])
        self.assertIn('building-levels-exceed-review-threshold', provenance['reviewReasons'])

    def test_missing_and_invalid_values_fall_back_with_traceable_provenance(self):
        self.assertEqual(prepare_data.building_height({}), (6.0, 'default-estimate'))
        self.assertEqual(
            prepare_data.building_height({'height': 'unknown', 'building:levels': 'NaN'}),
            (6.0, 'default-estimate'))
        _, _, provenance = prepare_data.building_height_with_provenance(
            {'height': 'unknown', 'building:levels': 'NaN'}, 'way', 17)
        self.assertEqual(provenance['rawHeightTag'], 'unknown')
        self.assertEqual(provenance['rawBuildingLevelsTag'], 'NaN')
        self.assertTrue(provenance['reviewRequired'])
        self.assertFalse(provenance['independentMeasurement'])

    def test_source_tags_are_recorded_as_unverified_osm_claims(self):
        height, source, provenance = prepare_data.building_height_with_provenance(
            {'height': '452', 'building:levels': '93'}, 'way', 527545453)
        self.assertEqual((height, source), (452.0, 'height-tag'))
        self.assertEqual(provenance['sourceType'], 'way')
        self.assertEqual(provenance['sourceId'], '527545453')
        self.assertEqual(provenance['normalizedHeightMeters'], 452.0)
        self.assertFalse(provenance['independentMeasurement'])

    def test_four_real_changsha_source_ids_match_existing_chunk_values(self):
        expected = {
            '527545451': 315.0,
            '527545453': 452.0,
            '543405242': 420.0,
            '543405244': 420.0,
        }
        raw = json.loads((ROOT / 'data/raw/changsha-world.osm.json').read_text(encoding='utf-8'))
        source_rows = {
            str(row['id']): row
            for row in raw['ways']
            if str(row.get('id')) in expected
        }
        self.assertEqual(set(source_rows), set(expected))
        chunk = json.loads((ROOT / 'data/chunks/-3_0.json').read_text(encoding='utf-8'))
        chunk_rows = {row['id']: row for row in chunk['buildings'] if row['id'] in expected}
        self.assertEqual(set(chunk_rows), set(expected))
        for source_id, expected_height in expected.items():
            with self.subTest(source_id=source_id):
                tags = source_rows[source_id]['tags']
                height, method = prepare_data.building_height(tags)
                self.assertEqual(height, expected_height)
                self.assertEqual(method, 'height-tag')
                self.assertEqual(chunk_rows[source_id]['height'], expected_height)
                provenance = chunk_rows[source_id]['heightProvenance']
                self.assertEqual(provenance['sourceType'], 'way')
                self.assertEqual(provenance['sourceId'], source_id)
                self.assertEqual(provenance['normalizedHeightMeters'], expected_height)
                self.assertFalse(provenance['independentMeasurement'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
