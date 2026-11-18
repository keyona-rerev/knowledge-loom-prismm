/* InsightForge local preparation only. No service login, deployment or activation. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const SOURCE_URL='https://github.com/keyona-rerev/knowledge-loom-prismm.git';
export const SOURCE_COMMIT='bc6a561c230684aff0ffcd2bb1ca468b584346cb';
const fail=m=>{throw new Error(m)};
export function validate(owner,repo){
 if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner||'')||owner.includes('--'))fail('Use the GitHub account name from the reviewed profile URL.');
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(repo||'')||repo==='.'||repo==='..'||repo.includes('..'))fail('Use a simple new repository name, not a path.');
}
function run(command,args,cwd){
 const r=spawnSync(command,args,{cwd,stdio:'inherit',shell:false});
 if(r.error)fail(`${command} could not start. Install it from its official website, reopen the terminal and retry. No later command ran.`);
 if(r.status!==0)fail(`${command} stopped (exit ${r.status}). No later command ran. Keep the error, do not add permissions or run as administrator to bypass it.`);
}
export function patchFiles(folder,owner,repo){
 validate(owner,repo);
 const vite=path.join(folder,'vite.config.ts'),app=path.join(folder,'src','App.tsx');
 const a=fs.readFileSync(vite,'utf8'),b=fs.readFileSync(app,'utf8');
 const base=/base:\s*(['"])\/knowledge-loom-prismm\/\1/g,route=/basename=(["'])\/knowledge-loom-prismm\1/g;
 if((a.match(base)||[]).length!==1||(b.match(route)||[]).length!==1)fail('The source layout has changed. No path files were edited. Ask for a package update.');
 fs.writeFileSync(vite,a.replace(base,`base: '/${repo}/'`));
 fs.writeFileSync(app,b.replace(route,`basename="/${repo}"`));
 const pa=fs.readFileSync(vite,'utf8'),pb=fs.readFileSync(app,'utf8');
 if(!pa.includes(`base: '/${repo}/'`)||!pb.includes(`basename="/${repo}"`))fail('Path verification failed. Do not publish.');
 return {owner,repo,app_url:`https://${owner}.github.io/${repo}/`,source_commit:SOURCE_COMMIT,local_only:true,published:false};
}
export function prepare({workspace,owner,repo,execute=run}){
 validate(owner,repo);
 const folder=path.resolve(workspace,repo);
 if(fs.existsSync(folder))fail('That folder already exists. Nothing was changed. Choose a new empty location or ask Claude to inspect the existing folder; never delete it to force a retry.');
 execute('git',['--version'],workspace);
 fs.mkdirSync(folder);
 execute('git',['init'],folder);
 execute('git',['remote','add','origin',SOURCE_URL],folder);
 execute('git',['fetch','--depth','1','origin',SOURCE_COMMIT],folder);
 execute('git',['checkout','-b','insightforge-install','FETCH_HEAD'],folder);
 const report=patchFiles(folder,owner,repo);
 execute('git',['rm','--ignore-unmatch','-f','.env'],folder);
 execute('git',['rm','--ignore-unmatch','-rf','setup-wizard'],folder);
 execute('git',['remote','set-url','origin',`https://github.com/${owner}/${repo}.git`],folder);
 execute('git',['diff','--check'],folder);
 if(fs.existsSync(path.join(folder,'.env'))||fs.existsSync(path.join(folder,'setup-wizard')))fail('Template cleanup did not finish. Do not publish.');
 fs.writeFileSync(path.join(folder,'INSTALL-PREPARED.json'),JSON.stringify(report,null,2)+'\n');
 console.log('LOCAL PREPARATION PASSED');
 console.log(`Folder: ${folder}`);
 console.log(`App destination: ${report.app_url}`);
 console.log('No client service was changed. No content was published.');
 console.log('Give Claude the INSTALL-PREPARED.json receipt to verify the result.');
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [owner,repo,...extra]=process.argv.slice(2);if(extra.length)fail('Expected only the GitHub owner and repository name.');prepare({workspace:process.cwd(),owner,repo});}
 catch(e){console.error('STOP: '+e.message);process.exitCode=1;}
}
