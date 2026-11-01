"""Generate synthetic, valid attachment fixtures using standard document libraries.
Temporary generation tools: python-docx 1.2.0, openpyxl 3.1.5,
python-pptx 1.0.2, reportlab 5.0.1, Pillow. Not application dependencies.
"""
from pathlib import Path
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches
from reportlab.pdfgen.canvas import Canvas
from PIL import Image, ImageDraw
root=Path(__file__).parent
word=Document()
word.add_heading('ERP demand attachment verification',0)
word.add_paragraph('Synthetic document. No real company, person or procurement data.')
table=word.add_table(rows=1,cols=3)
for cell,value in zip(table.rows[0].cells,['Material','Quantity','Unit']):cell.text=value
for values in [('Gloves','20','box'),('Spare part','3.125','piece')]:
 for cell,value in zip(table.add_row().cells,values):cell.text=value
word.save(root/'specification.docx')
book=Workbook();sheet=book.active;sheet.title='Demand'
sheet.append(['Material','Boxes','Pieces per box','Base quantity'])
sheet.append(['Gloves',20,12,240]);sheet.append(['Spare part',1,1,1])
for column in ['A','B','C','D']:sheet.column_dimensions[column].width=24
book.save(root/'quantities.xlsx')
slides=Presentation()
for title,body in [('Material identification','Check the original specification and exact package.'),('Applicant confirmation','An offered candidate preserves approval history. Confirmed content returns to draft.')]:
 slide=slides.slides.add_slide(slides.slide_layouts[1]);slide.shapes.title.text=title;slide.placeholders[1].text=body
slides.save(root/'instructions.pptx')
pdf=Canvas(str(root/'instructions.pdf'))
for number in [1,2]:
 pdf.setFont('Helvetica',18);pdf.drawString(72,760,'ERP private demand attachment')
 pdf.setFont('Helvetica',12);pdf.drawString(72,720,f'Synthetic verification page {number} of 2')
 pdf.drawString(72,690,'No real business data. Check preview paging and session.')
 pdf.showPage()
pdf.save()
image=Image.new('RGB',(96,64),(180,195,210));ImageDraw.Draw(image).text((24,24),'ERP',fill=(10,20,30))
for ext,fmt in [('jpg','JPEG'),('png','PNG'),('webp','WEBP')]:image.save(root/('sample.'+ext),fmt)
print('Created 7 synthetic file formats.')
