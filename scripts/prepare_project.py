from pathlib import Path
import subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
for script in ['download_region.py','prepare_pois.py','prepare_data.py','optimize_map.py','extract_named_pois.py','link_pois.py']:
    print(f'PREPARE {script}',flush=True)
    subprocess.run([sys.executable,str(ROOT/'scripts'/script)],cwd=ROOT,check=True)
