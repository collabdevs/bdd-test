<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class SubCategorie extends Model {

    protected $fillable = ["name", "desc", "categorie_id"];

    protected $dates = [];

    public static $rules = [
        "name" => "required|min:3",
        "categorie_id" => "required|numeric",
    ];

    public $timestamps = false;

    public function products()
    {
        return $this->hasMany("App\Product");
    }

    public function categorie()
    {
        return $this->belongsTo("App\Categorie");
    }


}
