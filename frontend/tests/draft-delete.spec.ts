import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page,reject=false){
  const exam={id:'draft-exam',title:'Qoralama sinov',subject:'Ona tili',description:'',duration_minutes:90,question_count:3,status:'draft',certificate_thresholds:{'A+':70,A:65,'B+':60,B:55,'C+':50,C:46},essay_required:false,expert_count:1,answer_released:false,results_published:false};
  let questions=['Birinchi savol','Ikkinchi savol','Uchinchi savol'].map((text,i)=>({id:`q${i+1}`,position:i+1,kind:'short',text,topic:'Umumiy',passage_id:null,image_paths:[],options:[],parts:[{id:`p${i+1}`,label:'main',prompt:'',weight:1,accepted:['javob'],manual_review:false,case_sensitive:false}]}));
  let exams=[exam,{...exam,id:'published-exam',title:'E’lon qilingan sinov',status:'published'}];
  const deletes:string[]=[];
  await page.route('https://telegram.org/js/telegram-web-app.js*',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>sessionStorage.setItem('access_token','draft-delete-fixture'));
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let body:unknown=[];
    if(request.method()==='DELETE'){
      deletes.push(path);
      if(reject){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'Faqat hali boshlanmagan qoralamani tahrirlash mumkin'})});return;}
      if(path.includes('/questions/'))questions=questions.filter(q=>q.id!==path.split('/').at(-1)).map((q,i)=>({...q,position:i+1}));
      else exams=exams.filter(e=>e.id!==path.split('/').at(-1));
      body={ok:true};
    }else if(path==='/api/config')body={dev_auth:false};
    else if(path==='/api/me')body={id:'teacher',name:'O‘qituvchi',role:'teacher',active:true,telegram_id:1234,avatar_url:null};
    else if(path==='/api/teacher/exams')body=exams;
    else if(path==='/api/teacher/exams/draft-exam')body={...exam,questions,question_count:questions.length,passages:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  return deletes;
}

test('question deletion confirms, cancels and refreshes renumbered questions',async({page})=>{
  const deletes=await setup(page);await page.goto('/teacher/exams/draft-exam');
  await page.getByRole('button',{name:'2-savolni o‘chirish',exact:true}).click();
  await page.getByRole('button',{name:'Bekor qilish',exact:true}).click();expect(deletes).toEqual([]);
  await page.getByRole('button',{name:'2-savolni o‘chirish',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'O‘chirish',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Savol o‘chirildi');
  await expect(page.getByRole('button',{name:'2 Uchinchi savol',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'3-savolni o‘chirish',exact:true})).toHaveCount(0);
  expect(deletes).toEqual(['/api/teacher/exams/draft-exam/questions/q2']);
});

test('dashboard deletes only confirmed drafts and preserves published exams',async({page})=>{
  const deletes=await setup(page);await page.goto('/teacher');
  await expect(page.getByRole('button',{name:'E’lon qilingan sinov imtihonini o‘chirish',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Qoralama sinov imtihonini o‘chirish',exact:true}).click();
  await page.getByRole('button',{name:'Bekor qilish',exact:true}).click();expect(deletes).toEqual([]);
  await page.getByRole('button',{name:'Qoralama sinov imtihonini o‘chirish',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'O‘chirish',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Qoralama imtihon o‘chirildi');
  await expect(page.getByRole('button',{name:'Qoralama sinov imtihonini o‘chirish',exact:true})).toHaveCount(0);
  await expect(page.getByRole('cell',{name:'E’lon qilingan sinov',exact:true})).toBeVisible();
  expect(deletes).toEqual(['/api/teacher/exams/draft-exam']);
});

test('delete conflict is visible inside confirmation and leaves editor intact',async({page})=>{
  const deletes=await setup(page,true);await page.goto('/teacher/exams/draft-exam');
  await page.getByRole('button',{name:'2-savolni o‘chirish',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'O‘chirish',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Faqat hali boshlanmagan qoralamani');
  await page.getByRole('button',{name:'Bekor qilish',exact:true}).click();
  await expect(page.getByRole('button',{name:'2 Ikkinchi savol',exact:true})).toBeVisible();
  expect(deletes).toHaveLength(1);
});
