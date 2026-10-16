"""Reduce 2D overview geometry only. The real 3D chunks and road graph remain unchanged."""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.python-deps'))
from shapely.geometry import LineString,Polygon
def main():
 path=ROOT/'data/map.json';before=path.stat().st_size;data=json.loads(path.read_text(encoding='utf-8'))
 for road in data['roads']:
  points=list(LineString(road['points']).simplify(4,preserve_topology=True).coords)
  road['points']=[[round(x,1),round(z,1)] for x,z in points]
 for water in data['water']:
  polygon=Polygon(water['polygon'],water.get('holes',[])).simplify(2,preserve_topology=True)
  if polygon.is_empty:continue
  water['polygon']=[[round(x,1),round(z,1)] for x,z in polygon.exterior.coords]
  water['holes']=[[[round(x,1),round(z,1)] for x,z in ring.coords] for ring in polygon.interiors]
 data['overviewGeometry']={'roadToleranceMeters':4,'waterToleranceMeters':2,'purpose':'2D overview only; full 3D geometry and routing graph preserved'}
 path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print(json.dumps({'beforeBytes':before,'afterBytes':path.stat().st_size,'roads':len(data['roads']),'waterPolygons':len(data['water'])}))
if __name__=='__main__':main()
