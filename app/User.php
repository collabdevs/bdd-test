<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class User extends Model {

    use \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ["name", "email", "password", "group_id"];

    protected $dates = [];

    public static $rules = [
        "name" => "required",
        "email" => "required",
        "password" => "required",
        "group_id" => "required|numeric",
    ];

    public function group()
    {
        return $this->belongsTo("App\Group");
    }


}
