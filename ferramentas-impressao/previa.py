# Decodifica os bytes que o programa manda pra impressora e desenha o que sairia no papel (ILUSTRATIVO, não é foto de impressão).
# Precisa de: pip install pillow python-barcode
import sys, re
from PIL import Image, ImageDraw, ImageFont
import barcode
MONO='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'; MONOB='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'

def recibo(path, out):
    b=open(path,'rb').read(); i=0; linha=bytearray(); alinh=0; neg=False; linhas=[]
    def fecha():
        nonlocal linha
        linhas.append((linha.decode('cp860',errors='replace'),alinh,neg)); linha=bytearray()
    while i<len(b):
        c=b[i]
        if c==0x1b:
            k=b[i+1]
            if k==0x40: i+=2
            elif k==0x74: i+=3
            elif k==0x61: alinh=b[i+2]; i+=3
            elif k==0x45: neg=bool(b[i+2]); i+=3
            else: i+=2
        elif c==0x1d:
            i+= 4 if b[i+1]==0x56 and b[i+2]>=0x41 else 3; linhas.append(('--- corte ---',1,False))
        elif c==0x0a: fecha(); i+=1
        else: linha.append(c); i+=1
    if linha: fecha()
    f=ImageFont.truetype(MONO,20); fb=ImageFont.truetype(MONOB,20)
    W=576; H=24*len(linhas)+40
    im=Image.new('RGB',(W+40,H),'white'); d=ImageDraw.Draw(im)
    d.rectangle([19,0,W+20,H],outline=(200,200,200))
    for n,(t,a,bold) in enumerate(linhas):
        ff=fb if bold else f; w=d.textlength(t,font=ff); x=20+(0 if a==0 else (W-w)/2 if a==1 else W-w)
        d.text((x,20+24*n),t,font=ff,fill='black')
    im.save(out); return len(linhas)

def code128(d,x,y,h,cod,narrow):
    mods=barcode.get('code128',cod).build()[0]
    for m in mods:
        for _ in range(narrow):
            pass
    cx=x
    for m in mods:
        if m=='1': d.rectangle([cx,y,cx+narrow-1,y+h],fill='black')
        cx+=narrow
    return cx-x
def etiqueta(path, out):
    t=open(path,'rb').read().decode('latin1'); W=H=0; copias=1
    fontes={'1':(8,12),'2':(12,20),'3':(16,24),'4':(24,32),'5':(32,48)}
    cmds=[]
    for l in t.splitlines():
        m=re.match(r'SIZE (\d+) mm,(\d+) mm',l)
        if m: W=int(m[1])*203//25.4; H=int(m[2])*203//25.4; W=int(W);H=int(H)
        m=re.match(r'PRINT (\d+),(\d+)',l)
        if m: copias=int(m[2])
        if l.startswith(('TEXT','BARCODE')): cmds.append(l)
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    for l in cmds:
        if l.startswith('TEXT'):
            m=re.match(r'TEXT (\d+),(\d+),"(\w+)",\d+,(\d+),(\d+),"(.*)"',l); x,y,fid,xm,ym,s=int(m[1]),int(m[2]),m[3],int(m[4]),int(m[5]),m[6]
            cw,ch=fontes.get(fid,(16,24)); f=ImageFont.truetype(MONO,int(cw/0.602)*xm)
            d.text((x,y),s,font=f,fill='black')
        else:
            m=re.match(r'BARCODE (\d+),(\d+),"(\w+)",(\d+),\d+,\d+,(\d+),(\d+),"(.*)"',l); x,y,h,n,cod=int(m[1]),int(m[2]),int(m[4]),int(m[5]),m[7]
            code128(d,x,y,h,cod,n)
    d.rectangle([0,0,W-1,H-1],outline=(160,160,160)); im=im.resize((W*2,H*2),Image.NEAREST); im.save(out); return (W,H,copias)
if __name__=='__main__':
    # uso: python3 previa.py recibo.prn recibo.png   |   python3 previa.py etiqueta.prn etiqueta.png
    arq, saida = sys.argv[1], sys.argv[2]
    ini = open(arq,'rb').read(5)
    print(recibo(arq, saida) if ini[:2] == b'\x1b@' else etiqueta(arq, saida))
