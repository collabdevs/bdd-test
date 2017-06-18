<?php

require_once "Spyc.php";
$dados = Spyc::YAMLLoad('Store.yml');
//$Data = spyc_load_file('spes.yaml');
//var_dump($dados);

foreach ($dados as $nome => $value) {
	# code...
	echo $nome;
	//print_r($value['fields']);
	$campos ='';
	foreach ($value['fields'] as $k => $campo) {
		//print_r($k);

		//print_r($campo);
		$campos .='<div class="form-group"><label class="col-sm-2 control-label">Normal</label>
            <div class="col-sm-10"><input type="text" class="form-control"></div>
        </div>
        <div class="hr-line-dashed"></div>;';
		# code...
	}
	file_put_contents('public/adm/views/models/'.$nome.'.html', $campos);
	
}



/*echo '<div class="form-group"><label class="col-sm-2 control-label">Normal</label>
            <div class="col-sm-10"><input type="text" class="form-control"></div>
        </div>
        <div class="hr-line-dashed"></div>;';*/