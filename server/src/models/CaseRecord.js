import mongoose from 'mongoose';

const caseRecordSchema=new mongoose.Schema({
  caseId:{type:String,required:true,unique:true,index:true},
  guestId:{type:String,required:true,index:true},
  payload:{type:mongoose.Schema.Types.Mixed,required:true},
  createdAt:{type:Date,required:true},
  expiresAt:{type:Date,default:null,index:{expireAfterSeconds:0}},
  shareToken:{type:String,default:null,index:{unique:true,sparse:true}}
},{timestamps:true});

export const CaseRecord=mongoose.models.CaseRecord||mongoose.model('CaseRecord',caseRecordSchema);
