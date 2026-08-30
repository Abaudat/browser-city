# -*- coding: utf-8 -*-
"""Regenerate the tracker, preserving any status already recorded and never
downgrading one. This is the property Story 0.10 requires."""
import io, os, re, glob, datetime, sys

EPICS='_bmad-output/planning-artifacts/epics'
OUT='_bmad-output/implementation-artifacts/sprint-status.yaml'
RANK={'backlog':0,'optional':0,'ready-for-dev':1,'in-progress':2,'review':3,'done':4}

def kebab(t):
    t=t.lower().replace("'","").replace(u'\u2019','')
    return re.sub(r'[^a-z0-9]+','-',t).strip('-')

prev={}
if os.path.exists(OUT):
    for ln in io.open(OUT,encoding='utf-8'):
        m=re.match(r'^  ([a-z0-9\-\.]+): (\S+)\s*$',ln)
        if m: prev[m.group(1)]=m.group(2)

epic_re=re.compile(r'^## Epic (\d+): (.+)$'); story_re=re.compile(r'^### Story (\d+)\.(\d+): (.+)$')
epics=[]
for p in sorted(glob.glob(os.path.join(EPICS,'epic-*.md')),key=lambda p:int(re.search(r'epic-(\d+)',p).group(1))):
    num=None; st=[]
    for ln in io.open(p,encoding='utf-8').read().split('\n'):
        m=epic_re.match(ln)
        if m and num is None: num=m.group(1)
        s=story_re.match(ln)
        if s: st.append((s.group(1),s.group(2),s.group(3)))
    epics.append((num,st))

def keep(key,default):
    old=prev.get(key)
    if old is None: return default
    return old if RANK.get(old,0)>=RANK.get(default,0) else default

head=io.open(OUT,encoding='utf-8').read().split('development_status:')[0].rstrip('\n')
head=re.sub(r'^# last_updated: .*$','# last_updated: '+datetime.datetime.now().strftime('%d-%m-%Y %H:%M'),head,flags=re.M)
out=[head,'','development_status:']
for num,stories in epics:
    ek='epic-%s'%num
    out.append('  %s: %s'%(ek,keep(ek,'backlog')))
    for e,s,t in stories:
        k='%s-%s-%s'%(e,s,kebab(t))
        out.append('  %s: %s'%(k,keep(k,'backlog')))
    out.append('  %s-retrospective: %s'%(ek,keep(ek+'-retrospective','optional')))
    out.append('')
io.open(OUT,'w',encoding='utf-8',newline='').write('\n'.join(out).rstrip()+'\n')
print('regenerated, %d statuses carried forward'%len(prev))
