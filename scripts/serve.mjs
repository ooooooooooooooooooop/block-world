import http from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.argv[2]||process.cwd());
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.csv':'text/csv; charset=utf-8'};
const server=http.createServer((req,res)=>{
  let requested;try{requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(requested==='/') requested='/index.html';
  if(requested.startsWith('/vendor/three/')&&existsSync(resolve(root,'node_modules/three/build'))) requested=requested.replace('/vendor/three/','/node_modules/three/build/');
  const path=resolve(root,'.'+requested);
  if(!path.startsWith(root+sep)||requested.includes('/raw/')||requested.includes('/.')){res.writeHead(403).end('Forbidden');return;}
  if(!existsSync(path)||!statSync(path).isFile()){res.writeHead(404).end('Not found');return;}
  res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-cache');
  createReadStream(path).pipe(res);
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
